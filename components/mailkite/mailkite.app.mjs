import { axios } from "@pipedream/platform";

export default {
  type: "app",
  app: "mailkite",
  propDefinitions: {
    domainId: {
      type: "string",
      label: "Domain",
      description:
        "A MailKite domain that is **MX-verified** (required to receive inbound email).",
      async options() {
        // GET /api/domains returns a bare array of domain rows
        // ({ id, domain, mx_verified, ... }) — see MailKite api/src/index.ts.
        const domains = await this.listDomains();
        return (domains ?? [])
          .filter((d) => d.mx_verified)
          .map((d) => ({
            label: d.domain,
            value: d.id,
          }));
      },
    },
  },
  methods: {
    _baseUrl() {
      return "https://api.mailkite.dev";
    },
    _headers() {
      // The `api_key` field is provisioned by Pipedream when the app is created.
      return {
        Authorization: `Bearer ${this.$auth.api_key}`,
        "Content-Type": "application/json",
      };
    },
    async _request({
      $ = this, path, ...opts
    }) {
      return axios($, {
        url: `${this._baseUrl()}${path}`,
        headers: this._headers(),
        ...opts,
      });
    },
    // GET /api/domains — used by the domain async-options picker.
    async listDomains(opts = {}) {
      return this._request({
        path: "/api/domains",
        ...opts,
      });
    },
    // PUT /api/domains/:id/webhook — register a Source's endpoint for inbound mail.
    async setWebhook({
      domainId, ...opts
    }) {
      return this._request({
        method: "PUT",
        path: `/api/domains/${domainId}/webhook`,
        ...opts,
      });
    },
    // DELETE /api/domains/:id/webhook
    async deleteWebhook({
      domainId, ...opts
    }) {
      return this._request({
        method: "DELETE",
        path: `/api/domains/${domainId}/webhook`,
        ...opts,
      });
    },
    // POST /v1/send
    async sendEmail(opts = {}) {
      return this._request({
        method: "POST",
        path: "/v1/send",
        ...opts,
      });
    },
  },
};
