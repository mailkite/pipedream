# MailKite × Pipedream connector — implementation plan

Phased build of the MailKite app for the Pipedream registry: an inbound **Source**
("New Inbound Email") + a **Send Email** action. Lint + push at the end of each phase.

> **The one external gate:** Pipedream must create the `mailkite` app in their registry
> (with **API-key auth**, header `Authorization: Bearer <key>`) before connected-account
> testing (`pd dev`/`pd publish`) and the registry PR can land. Requested via GitHub issue —
> awaiting reply. Everything in this repo is built and lintable without it.

## Phase 1 — Bootstrap repo
- [x] `git init`, MIT `LICENSE`, `.gitignore`
- [x] Root `package.json` + flat `eslint.config.js` (ESM, node globals)
- [x] `README.md` + this `PLAN.md`
- [x] `npm install`, `npm run lint` clean
- [x] Create public GitHub repo `mailkite/pipedream`, push

## Phase 2 — App definition
- [x] `components/mailkite/mailkite.app.mjs` — Bearer auth, shared HTTP methods, domain picker
      (bare-array `GET /api/domains`; label `d.domain`, value `d.id`, filter `d.mx_verified`)
- [x] `components/mailkite/package.json` — `@pipedream/platform` dependency
- [x] Lint clean · commit · push

## Phase 3 — Components
- [x] `actions/send-email/send-email.mjs` — `POST /v1/send`
- [x] `sources/new-inbound-email/new-inbound-email.mjs` — Instant webhook trigger
      (register on `activate`, HMAC-SHA256 signature verify, emit `email.received`)
- [x] `sources/new-inbound-email/test-event.mjs`
- [x] Lint clean · commit · push

## Phase 4 — Docs + finalize
- [x] `components/mailkite/README.md` — Overview / Example Use Cases / Getting Started / Troubleshooting
- [x] Repo `README.md` — how to PR into `PipedreamHQ/pipedream`
- [x] Update email-repo `docs/marketing/promotion/25-integration-pipedream.md` (corrected picker + repo link)
- [x] Final lint/health · commit · push · email summary

## Confirmed contracts (from `api/src`)
| Piece | MailKite API |
|---|---|
| Send | `POST api.mailkite.dev/v1/send` · Bearer → `{ id, status }` |
| List domains | `GET /api/domains` → **bare array** of `{ id, domain, mx_verified, … }` |
| Register webhook | `PUT /api/domains/:id/webhook` `{ url, ackMode }` (MX-verified domain) |
| Inbound payload | `{ id, type:"email.received", from:{address}, to:[{address}], subject, text, html, threadId, auth:{spf,dkim,dmarc,spam}, attachments }` |
| Signature | header `x-mailkite-signature: t=<ms>,v1=<hex>` · HMAC-SHA256 over `` `${t}.${rawBody}` `` |

## Pre-PR checks still open
- [ ] Confirm Pipedream exposes `event.bodyRaw` for the HTTP source (needed for byte-exact HMAC).
- [ ] App created by Pipedream + `api_key` auth field present → then `pd login`, `pd dev`, open PR.
