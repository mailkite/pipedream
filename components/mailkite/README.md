# MailKite

[MailKite](https://mailkite.dev) is developer-first email infrastructure: **receive email as a
clean JSON webhook** and **send email with one API call**, on your own verified domains.

## Overview

This app provides two components:

- **New Inbound Email (Instant)** — a source that triggers a workflow the moment an email arrives
  at one of *your* MX-verified MailKite domains. Unlike a generic "new email" trigger tied to a
  vendor-generated address, this fires for mail to your real domain (`support@yourcompany.com`).
  Each event is the parsed message: `from`, `to`, `subject`, `text`, `html`, `threadId`,
  authentication results (`spf`/`dkim`/`dmarc`/`spam`), and `attachments` (with signed download
  URLs).
- **Send Email** — an action that sends a message from a verified domain: `to`/`cc`/`bcc`,
  `subject`, `html`/`text`, `reply-to`, and saved or base templates with merge data.

## Example Use Cases

- **Reply-by-email support inbox** — inbound customer replies trigger a workflow that creates a
  ticket, runs an AI draft, and sends the response with **Send Email**.
- **Give an AI agent its own inbox** — route mail to a domain, let an agent read each message and
  act (lookup, summarize, respond).
- **Inbound-to-database** — parse incoming mail and append rows to Sheets, Notion, or Postgres.
- **Transactional send** — fire receipts, magic links, or notifications from any workflow.

## Getting Started

1. **Create a MailKite account** and add a domain at [mailkite.dev](https://mailkite.dev).
2. **Verify the domain's DNS** — MX (to receive) and SPF + DKIM (to send). Inbound and outbound
   are gated until the relevant records verify.
3. **Connect your account** in Pipedream using a MailKite **API key** (`mk_live_…`).
4. **To receive:** add the *New Inbound Email* source, pick your verified domain, and (recommended)
   paste the **Webhook Signing Secret** from your MailKite dashboard so signatures are verified.
   The source registers its endpoint with MailKite automatically.
5. **To send:** add the *Send Email* action, set the `From` to an address on a verified domain, and
   provide `html`/`text` or a `Template ID`.

## Troubleshooting

- **No inbound events?** The domain must be **MX-verified** — the domain picker only lists
  MX-verified domains, and webhook registration is rejected otherwise. Confirm mail is actually
  reaching MailKite (check the dashboard's message log).
- **Signature check failing?** Make sure the **Webhook Signing Secret** matches the one in your
  MailKite dashboard. The signature is HMAC-SHA256 over `` `${timestamp}.${rawBody}` `` and the
  header is `x-mailkite-signature: t=<ms>,v1=<hex>`.
- **Send rejected?** The `From` address must be on a **verified sending domain** (SPF + DKIM).
  Provide at least one of `html`, `text`, or a `Template ID`, plus a `Subject` (unless the template
  supplies one).
- **MailKite retrying deliveries?** If you set **Acknowledgement Mode** to `ack`, the source must
  return `2xx` with `{"status":"ok"}` — it does this automatically; leave it on `lenient` if your
  downstream steps are slow.
