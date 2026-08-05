import crypto from "crypto";
import mailkite from "../../mailkite.app.mjs";
import sampleEmit from "./test-event.mjs";

export default {
  key: "mailkite-new-inbound-email",
  name: "New Inbound Email (Instant)",
  description:
    "Emit new event when an email arrives at a verified MailKite domain. [See the documentation](https://mailkite.dev/docs/).",
  version: "0.0.2",
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
    verifySignature(secret, signatureHeader, rawBody) {
      if (!signatureHeader) {
        return false;
      }
      const parts = Object.fromEntries(
        signatureHeader.split(",").map((kv) => kv.split("=")),
      );
      if (!parts.t || !parts.v1) {
        return false;
      }
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${parts.t}.${rawBody}`)
        .digest("hex");
      const a = Buffer.from(expected);
      const b = Buffer.from(parts.v1);
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

    // 2) Verify the signature over the exact raw body MailKite signed. The secret persisted at
    // activate() makes this always-on; `webhookSecret` only overrides it (e.g. after rotation).
    const secret = this.webhookSecret || this.db.get("signingSecret");
    const raw = bodyRaw ?? JSON.stringify(body);
    if (secret && !this.verifySignature(secret, headers["x-mailkite-signature"], raw)) {
      console.log("Rejected event: invalid x-mailkite-signature");
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
