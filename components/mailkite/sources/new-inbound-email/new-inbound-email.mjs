import crypto from "crypto";
import mailkite from "../../mailkite.app.mjs";
import sampleEmit from "./test-event.mjs";

// Reject a delivery whose signature timestamp is further than this from now, in either
// direction, so a captured delivery cannot be replayed forever. Same window the MailKite
// SDKs enforce (`DEFAULT_TOLERANCE_MS` in `sdks/node/index.js`).
export const FRESHNESS_MS = 5 * 60 * 1000;

export default {
  key: "mailkite-new-inbound-email",
  name: "New Inbound Email (Instant)",
  description:
    "Emit new event when an email arrives at a verified MailKite domain. [See the documentation](https://mailkite.dev/docs/).",
  version: "0.0.3",
  type: "source",
  dedupe: "unique",
  props: {
    mailkite,
    db: "$.service.db",
    http: {
      type: "$.interface.http",
      customResponse: true,
    },
    domainId: {
      propDefinition: [
        mailkite,
        "domainId",
      ],
    },
    webhookSecret: {
      type: "string",
      secret: true,
      label: "Webhook Signing Secret Override",
      description:
        "Signature verification (HMAC-SHA256) is on by default using the secret MailKite issues " +
        "when this source registers its webhook — no setup needed. Set this only to override that " +
        "secret (e.g. it was rotated in the MailKite dashboard → **Webhooks**).",
      optional: true,
    },
    ackMode: {
      type: "string",
      label: "Acknowledgement Mode",
      description:
        "`lenient` (default) accepts any 2xx response. `ack` requires this source to confirm receipt — MailKite retries until it does.",
      options: [
        "lenient",
        "ack",
      ],
      default: "lenient",
      optional: true,
    },
  },
  hooks: {
    async activate() {
      // A domain has one catch-all webhook route. Stash whatever is there before we replace
      // it, so deactivate() can put it back instead of deleting the user's existing wiring.
      const incumbent = await this.mailkite.getDomain({
        domainId: this.domainId,
      });
      this.db.set(
        "incumbentWebhook",
        incumbent?.webhookUrl
          ? { url: incumbent.webhookUrl, ackMode: incumbent.webhookAckMode ?? "lenient" }
          : null,
      );

      const { webhookUrl, signingSecret } = await this.mailkite.setWebhook({
        domainId: this.domainId,
        data: {
          url: this.http.endpoint,
          ackMode: this.ackMode,
        },
      });
      this.db.set("webhookUrl", webhookUrl);
      // Persist the secret MailKite just handed us so verification is on by default; the
      // `webhookSecret` prop remains only as an override (see run()).
      this.db.set("signingSecret", signingSecret);
    },
    async deactivate() {
      const incumbent = this.db.get("incumbentWebhook");
      if (incumbent) {
        await this.mailkite.setWebhook({
          domainId: this.domainId,
          data: {
            url: incumbent.url,
            ackMode: incumbent.ackMode,
          },
        });
      } else {
        await this.mailkite.deleteWebhook({
          domainId: this.domainId,
        });
      }
    },
  },
  methods: {
    /**
     * Verify an `x-mailkite-signature: t=<ms>,v1=<hex>` header over the exact bytes MailKite
     * signed. Mirrors the canonical verifier — `MailKite.verifyWebhook` in the MailKite Node
     * SDK — so there is one algorithm to reason about: `v1` is
     * `HMAC-SHA256(secret, "<t>.<rawBody>")` as lowercase hex, and `t` is milliseconds since
     * the epoch.
     *
     * @param {string} secret - The webhook signing secret (`whsec_…`).
     * @param {string} signatureHeader - Raw `x-mailkite-signature` header value.
     * @param {string} rawBody - The unparsed request body, byte-for-byte as delivered.
     * @param {number} [toleranceMs] - Replay window in ms; `0` disables the freshness check.
     * @returns {boolean} `true` only if the header is well-formed, fresh, and authentic.
     */
    verifySignature(secret, signatureHeader, rawBody, toleranceMs = FRESHNESS_MS) {
      if (typeof signatureHeader !== "string" || !signatureHeader) {
        return false;
      }
      const parts = {};
      for (const seg of signatureHeader.split(",")) {
        const i = seg.indexOf("=");
        if (i !== -1) {
          parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
        }
      }
      const t = Number(parts.t);
      if (!parts.t || !parts.v1 || !Number.isFinite(t)) {
        return false;
      }
      // Freshness: a delivery captured off the wire stops verifying once it is stale, and a
      // timestamp far in the future is equally suspect.
      if (toleranceMs > 0 && Math.abs(Date.now() - t) > toleranceMs) {
        return false;
      }
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${parts.t}.${rawBody}`)
        .digest("hex");
      // Compare decoded bytes, as the SDK does — invalid hex decodes short and fails on length.
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(parts.v1, "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  },
  async run(event) {
    const {
      headers, body, bodyRaw,
    } = event;

    // 1) Acknowledge first so MailKite does not retry.
    if (this.ackMode === "ack") {
      this.http.respond({
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        body: {
          status: "ok",
        },
      });
    } else {
      this.http.respond({
        status: 200,
        body: "ok",
      });
    }

    // 2) Verify the signature over the exact raw body MailKite signed, and only if it is
    // recent (see FRESHNESS_MS) — otherwise a delivery captured once replays forever. The
    // secret persisted at activate() makes this always-on; `webhookSecret` only overrides it
    // (e.g. after rotation).
    const secret = this.webhookSecret || this.db.get("signingSecret");
    const raw = bodyRaw ?? JSON.stringify(body);
    if (secret && !this.verifySignature(secret, headers["x-mailkite-signature"], raw)) {
      console.log("Rejected event: invalid or stale x-mailkite-signature");
      return;
    }

    // 3) Only emit inbound mail.
    if (body?.type !== "email.received") {
      return;
    }

    this.$emit(body, {
      id: body.id,
      summary: `New email from ${body.from?.address}: ${body.subject ?? "(no subject)"}`,
      ts: Date.now(),
    });
  },
  sampleEmit,
};
