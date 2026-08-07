# MailKite for Pipedream

Official [MailKite](https://mailkite.dev) components for [Pipedream](https://pipedream.com) —
the **inbound-email wedge** that Pipedream's built-in triggers leave open.

- 📥 **New Inbound Email (Instant)** — trigger a workflow when an email arrives at **your own
  verified domain** (not a Pipedream-generated address). Signed `email.received` webhook with
  parsed `from` / `to` / `subject` / `text` / `html` / `threadId` / `auth` / `attachments`.
- 📤 **Send Email** — send from a verified domain via one API call (templates, cc/bcc, reply-to).

Why this matters: Pipedream's built-in *New Email* trigger only gives you a Pipedream-generated
address. Receiving on your **own domain** otherwise means gluing AWS SES catch-all or Postmark
webhooks. These components close that gap.

## Repository layout

```
components/mailkite/
├── mailkite.app.mjs                       # auth + shared HTTP methods
├── package.json                           # component manifest (@pipedream/platform)
├── README.md                              # marketplace-rendered docs
├── sources/email-received-instant/
│   ├── email-received-instant.mjs         # the (Instant) webhook trigger
│   └── test-event.mjs                     # sample email.received payload
└── actions/send-email/
    └── send-email.mjs                     # Send Email action

test/
├── email-received-instant.test.mjs        # signature + freshness + run() gate (node --test)
├── register-stubs.mjs                     # --import entrypoint for the resolution hook
├── stub-loader.mjs                        # resolves @pipedream/platform locally
└── stubs/pipedream-platform.mjs           # throwing stand-in — tests never hit the network
```

This repo is the **canonical home** for MailKite's Pipedream components. They are contributed to
the public [`PipedreamHQ/pipedream`](https://github.com/PipedreamHQ/pipedream) registry, which is
what lists them at `pipedream.com/apps/mailkite`.

## Status

⏳ **Awaiting Pipedream app creation.** A registry PR can only attach to an app that exists in
Pipedream's system. We've requested the `mailkite` app (API-key auth) via Pipedream's
new-app process — see [`PLAN.md`](PLAN.md). All component code here is complete, lints clean, and
passes its test suite in the meantime.

## Getting it listed (PR into the registry)

1. Wait for Pipedream to create the `mailkite` app with an `api_key` auth field.
2. `pd login` (Pipedream CLI).
3. Fork [`PipedreamHQ/pipedream`](https://github.com/PipedreamHQ/pipedream); copy this repo's
   `components/mailkite/` into the fork's `components/mailkite/`.
4. Iterate locally:
   ```sh
   pd publish components/mailkite/sources/email-received-instant/email-received-instant.mjs --dev
   pd dev     components/mailkite/sources/email-received-instant/email-received-instant.mjs
   pd events  <source-name>     # watch events as real mail arrives
   pd publish components/mailkite/actions/send-email/send-email.mjs --dev
   ```
5. Open a PR against `PipedreamHQ/pipedream`. On merge it lists automatically — no fee, no
   security-review cycle.

## Develop

```sh
npm install
npm run lint
npm test        # node --test, no test framework and no Pipedream account needed
```

`npm test` imports the component files that actually ship. `@pipedream/platform` only resolves
inside Pipedream's own tooling, so `test/stub-loader.mjs` (a built-in Node resolution hook)
swaps it for a stub that throws if anything tries to make an HTTP call.

## License

MIT — see [`LICENSE`](LICENSE).
