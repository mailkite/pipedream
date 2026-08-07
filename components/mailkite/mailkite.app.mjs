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
    /**
     * Base URL of the MailKite REST API. Every path below is relative to it.
     *
     * @returns {string} The API origin, without a trailing slash.
     */
    _baseUrl() {
      return "https://api.mailkite.dev";
    },
    /**
     * Auth and content headers sent with every request. The `api_key` auth field is
     * provisioned by Pipedream when the app is created; a `mk_live_…` key is accepted on
     * both `/api/domains*` and `/v1/send`.
     *
     * @returns {object} Headers for a MailKite API request.
     */
    _headers() {
      return {
        Authorization: `Bearer ${this.$auth.api_key}`,
        "Content-Type": "application/json",
      };
    },
    /**
     * Issue a request against the MailKite API.
     *
     * @param {object} opts - Request options, passed through to `@pipedream/platform` axios.
     * @param {object} [opts.$] - Pipedream step context, for logging/observability. Defaults
     * to `this` (the component), which is what a source without a step context should pass.
     * @param {string} opts.path - API path beginning with `/`, e.g. `/api/domains`.
     * @returns {Promise<*>} The parsed response body.
     */
    async _request({
      $ = this, path, ...opts
    }) {
      return axios($, {
        url: `${this._baseUrl()}${path}`,
        headers: this._headers(),
        ...opts,
      });
    },
    /**
     * List the domains the authenticated account can use — `GET /api/domains`. Used by the
     * domain async-options picker. A domain-scoped API key sees exactly one domain.
     *
     * @param {object} [opts={}] - Extra request options (e.g. `$`).
     * @returns {Promise<object[]>} A bare array of domain rows (`{ id, domain, mx_verified, … }`).
     */
    async listDomains(opts = {}) {
      return this._request({
        path: "/api/domains",
        ...opts,
      });
    },
    /**
     * Fetch one domain — `GET /api/domains/:id`. The response is `{ domain, dns }`; only the
     * domain is returned here. Its `webhookUrl` / `webhookAckMode` describe the domain's
     * current catch-all webhook route, which the source stashes before taking it over.
     *
     * @param {object} opts - Request options.
     * @param {string} opts.domainId - Domain id to fetch.
     * @returns {Promise<object>} The domain row, including `webhookUrl` and `webhookAckMode`
     * when a webhook is registered.
     */
    async getDomain({
      domainId, ...opts
    }) {
      const { domain } = await this._request({
        path: `/api/domains/${domainId}`,
        ...opts,
      });
      return domain;
    },
    /**
     * Register (or replace) the domain's catch-all inbound webhook —
     * `PUT /api/domains/:id/webhook`. A domain has exactly one, so this overwrites any
     * incumbent route.
     *
     * @param {object} opts - Request options.
     * @param {string} opts.domainId - Domain to wire up.
     * @param {object} opts.data - Body: `{ url, ackMode }` — `ackMode` is `lenient` or `ack`.
     * @returns {Promise<object>} `{ domain, webhookUrl, ackMode, routeId, signingSecret }`;
     * `signingSecret` is the HMAC key for `x-mailkite-signature` and is returned here only.
     */
    async setWebhook({
      domainId, ...opts
    }) {
      return this._request({
        method: "PUT",
        path: `/api/domains/${domainId}/webhook`,
        ...opts,
      });
    },
    /**
     * Remove the domain's catch-all inbound webhook — `DELETE /api/domains/:id/webhook`.
     * Inbound mail stops being POSTed anywhere, so only call this when the domain had no
     * webhook before the source took it over.
     *
     * @param {object} opts - Request options.
     * @param {string} opts.domainId - Domain whose webhook is removed.
     * @returns {Promise<*>} The API's delete response.
     */
    async deleteWebhook({
      domainId, ...opts
    }) {
      return this._request({
        method: "DELETE",
        path: `/api/domains/${domainId}/webhook`,
        ...opts,
      });
    },
    /**
     * Send an email — `POST /v1/send`.
     *
     * @param {object} [opts={}] - Request options.
     * @param {object} opts.data - Send body: `from`, `to` (array), and one of `subject`+
     * `html`/`text` or `templateId`; `cc`, `bcc`, `replyTo`, `templateData` optional.
     * @returns {Promise<object>} `{ id, status }` — `status` is `scheduled` for a future
     * `scheduledAt`, otherwise the accepted-for-delivery status.
     */
    async sendEmail(opts = {}) {
      return this._request({
        method: "POST",
        path: "/v1/send",
        ...opts,
      });
    },
  },
};
