import mailkite from "../../mailkite.app.mjs";

export default {
  key: "mailkite-send-email",
  name: "Send Email",
  description:
    "Send an email from a verified MailKite domain. [See the documentation](https://mailkite.dev/docs/).",
  version: "0.0.1",
  type: "action",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  props: {
    mailkite,
    from: {
      type: "string",
      label: "From",
      description: "Sender address on a verified domain, e.g. `support@yourdomain.com`.",
    },
    to: {
      type: "string[]",
      label: "To",
      description: "One or more recipient addresses.",
    },
    subject: {
      type: "string",
      label: "Subject",
      description: "Email subject. Required unless you send a `Template ID`.",
      optional: true,
    },
    html: {
      type: "string",
      label: "HTML Body",
      description: "HTML content. Provide `HTML Body`, `Text Body`, or a `Template ID`.",
      optional: true,
    },
    text: {
      type: "string",
      label: "Text Body",
      description: "Plain-text content.",
      optional: true,
    },
    cc: {
      type: "string[]",
      label: "CC",
      optional: true,
    },
    bcc: {
      type: "string[]",
      label: "BCC",
      optional: true,
    },
    replyTo: {
      type: "string",
      label: "Reply-To",
      optional: true,
    },
    templateId: {
      type: "string",
      label: "Template ID",
      description: "A saved (`tpl_…`) or base (`base_…`) template. When set, `Subject`/`HTML Body`/`Text Body` become optional.",
      optional: true,
    },
    templateData: {
      type: "object",
      label: "Template Data",
      description: "Key/value pairs substituted into the template's `{{merge_tags}}`.",
      optional: true,
    },
  },
  async run({ $ }) {
    const data = {
      from: this.from,
      to: this.to,
      subject: this.subject,
      html: this.html,
      text: this.text,
      cc: this.cc,
      bcc: this.bcc,
      replyTo: this.replyTo,
      templateId: this.templateId,
      templateData: this.templateData,
    };
    // Only send the fields that were set.
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

    const response = await this.mailkite.sendEmail({
      $,
      data,
    });
    $.export("$summary", `Sent email to ${[].concat(this.to).join(", ")} (id: ${response.id})`);
    return response;
  },
};
