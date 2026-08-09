// Tests for the deploy() backfill hook (AUDIT-2026-08-03 finding B3): "webhook sources should
// fetch existing events in the deploy() hook, limited to 50 events maximum".
//
// The interesting part is not the 50 — it is that `GET /api/messages` cannot express any of
// the filters this needs. It has no direction filter, no domain filter (only a `search`
// substring), and its rows carry no bodies, so the source pages the account's newest mail,
// selects client-side, and re-fetches each survivor for its bodies and attachments. Each
// filter below is one of those, asserted against a list-row fixture built from the actual
// projection in MailKite's repo.listMessagesWithDelivery().
//
// The component under test is the one that ships; the app file's HTTP methods are the only
// thing stubbed (test/stub-loader.mjs already makes any real network call throw).
import assert from "node:assert/strict";
import {
  describe, it, mock,
} from "node:test";

import source, {
  BACKFILL_LIMIT,
  BACKFILL_MAX_PAGES,
  BACKFILL_PAGE_SIZE,
} from "../components/mailkite/sources/email-received-instant/email-received-instant.mjs";

const DOMAIN_ID = "dom_9f21";
const DOMAIN = "myapp.ai";
const T0 = 1785196800000; // 2026-07-28T00:00:00.000Z

/**
 * One row of `GET /api/messages`, matching the projection in repo.listMessagesWithDelivery():
 * bookkeeping columns and the structured from/to, but NO bodies and NO attachments.
 *
 * @param {object} [over={}] - Field overrides.
 * @returns {object} A message list row.
 */
function listRow(over = {}) {
  const id = over.id ?? "msg_0001";
  return {
    id,
    user_id: "usr_7fA2",
    route_id: "rte_9c31",
    direction: "inbound",
    from_addr: "ada@example.com",
    to_addr: `support@${DOMAIN}`,
    from: {
      address: "ada@example.com",
    },
    to: [
      {
        address: `support@${DOMAIN}`,
      },
    ],
    subject: `Message ${id}`,
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
    spam: "ham",
    thread_id: null,
    received_at: T0,
    size_bytes: 900,
    track_id: null,
    enc_key_fp: null,
    send_status: "sent",
    delivery_count: 0,
    attempts: null,
    last_status_code: null,
    delivered_count: 0,
    failed_count: 0,
    pending_count: 0,
    ...over,
  };
}

/**
 * Bind the component's own methods and hooks to a `this` whose app methods are stubs, the way
 * Pipedream binds them at runtime.
 *
 * @param {object} opts - Harness options.
 * @param {object[][]} opts.pages - Successive `listMessages()` responses, in call order.
 * @param {Function} [opts.getMessage] - Override for the detail fetch.
 * @param {string} [opts.domain] - The domain name `getDomain()` reports.
 * @returns {object} Harness: the bound hooks/methods plus recorded calls and emissions.
 */
function harness({
  pages, getMessage, domain = DOMAIN,
}) {
  const emitted = [];
  const listCalls = [];
  const fetched = [];
  let page = 0;
  const ctx = {
    ...source.methods,
    domainId: DOMAIN_ID,
    mailkite: {
      getDomain: async () => ({
        id: DOMAIN_ID,
        domain,
      }),
      listMessages: async (args) => {
        listCalls.push(args);
        return pages[page++] ?? [];
      },
      getMessage: getMessage ?? (async ({
        messageId,
      }) => {
        fetched.push(messageId);
        return {
          // The detail response for a row: same row, plus the bodies the list omits.
          message: {
            ...(pages.flat().find((r) => r.id === messageId)),
            text_body: `body of ${messageId}`,
            html_body: null,
          },
          attachments: [],
        };
      }),
    },
    $emit: (payload, meta) => emitted.push({
      payload,
      meta,
    }),
  };
  return {
    listBackfillRows: () => source.methods.listBackfillRows.call(ctx),
    deploy: () => source.hooks.deploy.call(ctx),
    emitted,
    listCalls,
    fetched,
  };
}

/**
 * Build `n` inbound rows for the chosen domain, newest first. `page` shifts both the ids and
 * the timestamps so successive pages hold distinct messages, the way the API's cursor paging
 * hands them over.
 *
 * @param {number} n - How many.
 * @param {object} [over={}] - Field overrides applied to each.
 * @param {number} [page=0] - Which page of `n` rows this is.
 * @returns {object[]} The rows.
 */
function rows(n, over = {}, page = 0) {
  const offset = page * n;
  return Array.from({
    length: n,
  }, (_, i) => listRow({
    id: `msg_${String(offset + i).padStart(4, "0")}`,
    received_at: T0 - (offset + i) * 1000,
    ...over,
  }));
}

describe("listBackfillRows — the filters the API cannot express", () => {
  it("keeps only inbound mail", async () => {
    // `/api/messages` returns the account's sends too, and an outbound row is not an
    // `email.received` event by any reading. The outbound row here is deliberately addressed
    // TO the domain (someone on the account emailing their own support address, which does
    // happen) — an outbound row to an outside recipient would be filtered by the domain check
    // anyway, so it would not test this rule at all.
    const h = harness({
      pages: [
        [
          listRow({
            id: "msg_in",
          }),
          listRow({
            id: "msg_out",
            direction: "outbound",
            from_addr: "founder@example.com",
            to_addr: `support@${DOMAIN}`,
          }),
        ],
      ],
    });
    assert.deepEqual((await h.listBackfillRows()).map((r) => r.id), [
      "msg_in",
    ]);
  });

  it("keeps only mail addressed to the selected domain", async () => {
    // There is no domain filter on the endpoint — an account with several domains would
    // otherwise backfill another domain's mail into this source.
    const h = harness({
      pages: [
        [
          listRow({
            id: "msg_mine",
          }),
          listRow({
            id: "msg_other",
            to_addr: "hello@other-domain.test",
          }),
          listRow({
            id: "msg_lookalike",
            to_addr: "hi@not-myapp.ai.example",
          }),
        ],
      ],
    });
    assert.deepEqual((await h.listBackfillRows()).map((r) => r.id), [
      "msg_mine",
    ]);
  });

  it("matches the recipient domain case-insensitively", async () => {
    const h = harness({
      pages: [
        [
          listRow({
            id: "msg_shouty",
            to_addr: `Support@${DOMAIN.toUpperCase()}`,
          }),
        ],
      ],
      domain: DOMAIN.toUpperCase(),
    });
    assert.equal((await h.listBackfillRows()).length, 1);
  });

  it("skips messages stored encrypted at rest, and says how many", async () => {
    // Their text_body/html_body are ciphertext the API never decrypts, so backfilling one
    // would emit an event whose body is unreadable noise.
    const logs = [];
    mock.method(console, "log", (m) => logs.push(m));
    const h = harness({
      pages: [
        [
          listRow({
            id: "msg_plain",
          }),
          listRow({
            id: "msg_enc1",
            enc_key_fp: "fp_ab12",
          }),
          listRow({
            id: "msg_enc2",
            enc_key_fp: "fp_ab12",
          }),
        ],
      ],
    });
    const selected = await h.listBackfillRows();
    mock.restoreAll();
    assert.deepEqual(selected.map((r) => r.id), [
      "msg_plain",
    ]);
    assert.match(logs.join("\n"), /skipped 2 message\(s\) stored encrypted at rest/);
  });

  it("stays silent when nothing was skipped", async () => {
    const logs = [];
    mock.method(console, "log", (m) => logs.push(m));
    const h = harness({
      pages: [
        rows(3),
      ],
    });
    await h.listBackfillRows();
    mock.restoreAll();
    assert.deepEqual(logs, []);
  });
});

describe("listBackfillRows — bounds", () => {
  it("selects at most 50 messages, the registry guideline's ceiling", async () => {
    const h = harness({
      pages: [
        rows(BACKFILL_PAGE_SIZE),
      ],
    });
    const selected = await h.listBackfillRows();
    assert.equal(BACKFILL_LIMIT, 50);
    assert.equal(selected.length, BACKFILL_LIMIT);
    // Newest first, so the 50 kept are the 50 most recent — not an arbitrary 50.
    assert.equal(selected[0].id, "msg_0000");
    assert.equal(selected.at(-1).id, `msg_${String(BACKFILL_LIMIT - 1).padStart(4, "0")}`);
  });

  it("pages until it has 50 for this domain, not just 50 rows", async () => {
    // A full page of another domain's mail must not end the backfill — that is the whole
    // reason for paging rather than asking for `limit=50` once.
    const h = harness({
      pages: [
        rows(BACKFILL_PAGE_SIZE, {
          to_addr: "hello@other-domain.test",
        }, 0),
        rows(BACKFILL_PAGE_SIZE, {}, 1),
      ],
    });
    assert.equal((await h.listBackfillRows()).length, BACKFILL_LIMIT);
    assert.equal(h.listCalls.length, 2);
    assert.equal(h.listCalls[0].limit, BACKFILL_PAGE_SIZE);
    assert.equal(h.listCalls[0].before, undefined, "the first page takes no cursor");
  });

  it("pages on a cursor that keeps rows sharing the boundary millisecond", async () => {
    // `before` is exclusive: paging on the last row's own timestamp silently drops every
    // other message that arrived in that same millisecond. `+1` re-reads the boundary row
    // instead, and the id set absorbs the overlap.
    const first = rows(BACKFILL_PAGE_SIZE, {
      to_addr: "hello@other-domain.test",
    });
    const boundary = first.at(-1);
    const h = harness({
      pages: [
        first,
        [
          boundary, // the re-read row
          listRow({
            id: "msg_tied",
            received_at: boundary.received_at, // same millisecond, would have been lost
          }),
        ],
      ],
    });
    const selected = await h.listBackfillRows();
    assert.equal(h.listCalls[1].before, boundary.received_at + 1);
    assert.deepEqual(selected.map((r) => r.id), [
      "msg_tied",
    ]);
  });

  it("stops on a short page — that is the end of the list", async () => {
    const h = harness({
      pages: [
        rows(3),
        rows(3),
      ],
    });
    assert.equal((await h.listBackfillRows()).length, 3);
    assert.equal(h.listCalls.length, 1, "no second call after a page shorter than the limit");
  });

  it("stops on an empty page", async () => {
    const h = harness({
      pages: [
        [],
      ],
    });
    assert.deepEqual(await h.listBackfillRows(), []);
    assert.equal(h.listCalls.length, 1);
  });

  it("stops at the page cap instead of walking the whole account", async () => {
    const h = harness({
      pages: Array.from({
        length: BACKFILL_MAX_PAGES + 3,
      }, (_, p) => rows(BACKFILL_PAGE_SIZE, {
        to_addr: "hello@other-domain.test",
      }, p)),
    });
    assert.deepEqual(await h.listBackfillRows(), []);
    assert.equal(h.listCalls.length, BACKFILL_MAX_PAGES);
  });

  it("stops when the cursor cannot advance, rather than spinning", async () => {
    // Pathological but cheap to guard: a page of rows already seen means no progress.
    const page = rows(BACKFILL_PAGE_SIZE, {
      to_addr: "hello@other-domain.test",
      received_at: T0,
    });
    const h = harness({
      pages: [
        page,
        page,
      ],
    });
    assert.deepEqual(await h.listBackfillRows(), []);
    assert.equal(h.listCalls.length, 2);
  });
});

describe("deploy() — what lands in the event list", () => {
  it("emits oldest-first, so the timeline reads chronologically", async () => {
    const h = harness({
      pages: [
        rows(3),
      ],
    });
    await h.deploy();
    assert.deepEqual(h.emitted.map((e) => e.payload.id), [
      "msg_0002",
      "msg_0001",
      "msg_0000",
    ]);
  });

  it("emits the same shape the live webhook emits, bodies included", async () => {
    const h = harness({
      pages: [
        [
          listRow({
            id: "msg_only",
          }),
        ],
      ],
    });
    await h.deploy();
    const {
      payload, meta,
    } = h.emitted[0];
    assert.equal(payload.type, "email.received");
    assert.equal(payload.id, "msg_only");
    // The bodies exist only on the detail response — proof the row was re-fetched.
    assert.deepEqual(h.fetched, [
      "msg_only",
    ]);
    assert.equal(payload.text, "body of msg_only");
    assert.equal(payload.receivedAtIso, new Date(payload.receivedAt).toISOString());
    // Same dedupe key as run(), so a live delivery arriving mid-backfill is not emitted twice.
    assert.equal(meta.id, "msg_only");
    assert.match(meta.summary, /ada@example\.com/);
    // ...and the event lands where the mail actually arrived, not at deploy time.
    assert.equal(meta.ts, payload.receivedAt);
  });

  it("keeps going when one message cannot be read back", async () => {
    const logs = [];
    mock.method(console, "log", (m) => logs.push(m));
    const h = harness({
      pages: [
        rows(3),
      ],
      getMessage: async ({
        messageId,
      }) => {
        if (messageId === "msg_0001") throw new Error("410 Gone");
        return {
          message: listRow({
            id: messageId,
          }),
          attachments: [],
        };
      },
    });
    await h.deploy();
    mock.restoreAll();
    assert.deepEqual(h.emitted.map((e) => e.payload.id), [
      "msg_0002",
      "msg_0000",
    ], "one unreadable message must not cost the user the others");
    assert.match(logs.join("\n"), /Skipped msg_0001 during backfill: 410 Gone/);
  });

  it("emits nothing when the domain has no stored mail", async () => {
    const h = harness({
      pages: [
        [],
      ],
    });
    await h.deploy();
    assert.deepEqual(h.emitted, []);
  });
});
