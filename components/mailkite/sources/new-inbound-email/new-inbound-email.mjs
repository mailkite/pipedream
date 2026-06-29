import crypto from "crypto";
import mailkite from "../../mailkite.app.mjs";
import sampleEmit from "./test-event.mjs";

export default {
  key: "mailkite-new-inbound-email",
  name: "New Inbound Email (Instant)",
  description:
    "Emit new event when an email arrives at a verified MailKite domain. [See the documentation](https://mailkite.dev/docs/).",
  version: "0.0.1",
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
      label: "Webhook Signing Secret",
      description:
        "From your MailKite dashboard → **Webhooks**. When set, every event's `x-mailkite-signature` header is verified (HMAC-SHA256). Strongly recommended.",
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
      const { webhookUrl } = await this.mailkite.setWebhook({
        domainId: this.domainId,
        data: {
          url: this.http.endpoint,
          ackMode: this.ackMode,
        },
      });
      this.db.set("webhookUrl", webhookUrl);
    },
    async deactivate() {
      await this.mailkite.deleteWebhook({
        domainId: this.domainId,
      });
    },
  },
  methods: {
    verifySignature(signatureHeader, rawBody) {
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
        .createHmac("sha256", this.webhookSecret)
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

    // 2) Verify the signature over the exact raw body MailKite signed.
    const raw = bodyRaw ?? JSON.stringify(body);
    if (this.webhookSecret && !this.verifySignature(headers["x-mailkite-signature"], raw)) {
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
