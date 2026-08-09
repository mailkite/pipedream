// Tests for the stored-message → `email.received` mapper the deploy() backfill runs on
// (AUDIT-2026-08-03 finding B3, and the third of C1's three targets).
//
// What makes this worth testing is that the REST shape and the webhook shape are NOT the same
// object with different names — the detail response carries fields the published schema
// forbids (`additionalProperties: false` on both the event and each attachment). The fixtures
// below are field-for-field what `GET /api/messages/:id` returns, so a test passing here means
// the mapper handles the real response, not a tidied-up idea of it.
//
// Contract: sdks/spec/schemas/email-received-event.json, built by `buildWebhookPayload()` in
// MailKite's api/src/index.ts. Dependency-free by design (same rule as the rest of the suite).
import assert from "node:assert/strict";
import {
  describe, it,
} from "node:test";

import {
  EVENT_ATTACHMENT_FIELDS,
  EVENT_FIELDS,
  toEmailReceivedEvent,
  toEventAddress,
  toEventAttachment,
} from "../components/mailkite/common/message-to-event.mjs";

const RECEIVED_AT = 1785196800000; // 2026-07-28T00:00:00.000Z

/**
 * A message exactly as `GET /api/messages/:id` returns it: the full stored row (snake_case
 * columns, API-only bookkeeping fields) plus the structured `from`/`to` the API adds via
 * `withStructuredAddresses()`.
 *
 * @param {object} [over={}] - Field overrides.
 * @returns {object} The detail-response `message` object.
 */
function detailMessage(over = {}) {
  return {
    id: "msg_2Hk9QpVn4tLd",
    user_id: "usr_7fA2",
    route_id: "rte_9c31",
    mailbox_id: "mbx_44",
    direction: "inbound",
    from_addr: "ada@example.com",
    to_addr: "support@myapp.ai",
    from: {
      address: "ada@example.com",
      name: "Ada Lovelace",
    },
    to: [
      {
        address: "support@myapp.ai",
        name: "Support",
      },
    ],
    subject: "Difference engine question",
    text_body: "Does the mill support conditional branching?",
    html_body: "<p>Does the mill support conditional branching?</p>",
    headers_json: "{\"from\":\"Ada Lovelace <ada@example.com>\"}",
    spf: "pass",
    dkim: "pass",
    dmarc: "pass",
    spam: "ham",
    thread_id: "<CA+1@example.com>",
    received_at: RECEIVED_AT,
    size_bytes: 4821,
    send_status: "sent",
    track_id: null,
    enc_key_fp: null,
    local_validate: null,
    actor_user_id: null,
    actor_team_id: null,
    ...over,
  };
}

/**
 * An attachment exactly as the detail endpoint's `attachmentPayload()` returns it — including
 * the two fields the webhook does not send.
 *
 * @param {object} [over={}] - Field overrides.
 * @returns {object} The detail-response attachment.
 */
function detailAttachment(over = {}) {
  return {
    id: "msg_2Hk9QpVn4tLd:0",
    filename: "notes.pdf",
    contentType: "application/pdf",
    size: 20481,
    contentId: null,
    disposition: "attachment",
    url: "https://api.mailkite.dev/att/2Hk9QpVn4tLd/0?exp=1754265600&sig=abc",
    ...over,
  };
}

describe("toEmailReceivedEvent — the webhook shape, exactly", () => {
  it("maps a detail response to the payload buildWebhookPayload() would have sent", () => {
    const event = toEmailReceivedEvent(detailMessage(), [
      detailAttachment(),
    ]);
    assert.deepEqual(event, {
      id: "msg_2Hk9QpVn4tLd",
      type: "email.received",
      from: {
        address: "ada@example.com",
        name: "Ada Lovelace",
      },
      to: [
        {
          address: "support@myapp.ai",
          name: "Support",
        },
      ],
      subject: "Difference engine question",
      text: "Does the mill support conditional branching?",
      html: "<p>Does the mill support conditional branching?</p>",
      threadId: "<CA+1@example.com>",
      receivedAt: RECEIVED_AT,
      receivedAtIso: "2026-07-28T00:00:00.000Z",
      auth: {
        spf: "pass",
        dkim: "pass",
        dmarc: "pass",
        spam: "ham",
      },
      attachments: [
        {
          filename: "notes.pdf",
          contentType: "application/pdf",
          size: 20481,
          id: "msg_2Hk9QpVn4tLd:0",
          url: "https://api.mailkite.dev/att/2Hk9QpVn4tLd/0?exp=1754265600&sig=abc",
        },
      ],
    });
  });

  it("leaks no API-only field the schema forbids", () => {
    // additionalProperties: false — `user_id`, `direction`, `headers_json`, `send_status` and
    // friends exist on the row and must not ride along into a user's workflow.
    const event = toEmailReceivedEvent(detailMessage());
    assert.deepEqual(
      Object.keys(event).filter((k) => !EVENT_FIELDS.includes(k)),
      [],
    );
    for (const gone of [
      "user_id",
      "direction",
      "from_addr",
      "to_addr",
      "headers_json",
      "received_at",
      "text_body",
      "html_body",
      "thread_id",
      "send_status",
      "enc_key_fp",
      "webhook_status",
    ]) {
      assert.equal(gone in event, false, `\`${gone}\` must not appear in the event`);
    }
  });

  it("renders receivedAtIso as the same instant as receivedAt, not the clock", () => {
    const event = toEmailReceivedEvent(detailMessage());
    assert.equal(event.receivedAt, RECEIVED_AT);
    assert.equal(event.receivedAtIso, new Date(RECEIVED_AT).toISOString());
  });

  it("accepts received_at as a numeric string, as JSON round-trips sometimes make it", () => {
    const event = toEmailReceivedEvent(detailMessage({
      received_at: String(RECEIVED_AT),
    }));
    assert.equal(event.receivedAt, RECEIVED_AT);
    assert.equal(typeof event.receivedAt, "number", "the schema types receivedAt as an integer");
  });

  it("nulls the optional text fields rather than dropping them", () => {
    const event = toEmailReceivedEvent(detailMessage({
      subject: null,
      text_body: null,
      html_body: null,
      thread_id: null,
    }));
    for (const field of [
      "subject",
      "text",
      "html",
      "threadId",
    ]) {
      assert.equal(field in event, true, `${field} stays present`);
      assert.equal(event[field], null);
    }
  });

  it("always scores all four auth verdicts, null meaning unknown", () => {
    const event = toEmailReceivedEvent(detailMessage({
      spf: "pass",
      dkim: null,
      dmarc: undefined,
      spam: null,
    }));
    assert.deepEqual(event.auth, {
      spf: "pass",
      dkim: null,
      dmarc: null,
      spam: null,
    });
  });

  it("emits an empty attachments array when there are none", () => {
    assert.deepEqual(toEmailReceivedEvent(detailMessage()).attachments, []);
    assert.deepEqual(toEmailReceivedEvent(detailMessage(), null).attachments, []);
  });

  it("refuses a row it cannot map faithfully", () => {
    assert.throws(() => toEmailReceivedEvent(null), TypeError);
    assert.throws(() => toEmailReceivedEvent({
      received_at: RECEIVED_AT,
    }), TypeError);
    assert.throws(() => toEmailReceivedEvent(detailMessage({
      received_at: null,
    })), /received_at/);
    assert.throws(
      () => toEmailReceivedEvent(detailMessage({
        from: undefined,
        from_addr: undefined,
      })),
      TypeError,
    );
  });
});

describe("toEventAddress — { address, name? }", () => {
  it("keeps a display name when the API resolved one", () => {
    assert.deepEqual(toEventAddress({
      address: "ada@example.com",
      name: "Ada Lovelace",
    }), {
      address: "ada@example.com",
      name: "Ada Lovelace",
    });
  });

  it("omits `name` — never nulls it — when unknown", () => {
    // The schema has no null branch on `name`; the API omits it when the MIME header names a
    // different address than the envelope, which is exactly the mailing-list/spoof case.
    for (const input of [
      {
        address: "ada@example.com",
      },
      {
        address: "ada@example.com",
        name: null,
      },
      {
        address: "ada@example.com",
        name: "",
      },
      "ada@example.com",
    ]) {
      const out = toEventAddress(input);
      assert.deepEqual(Object.keys(out), [
        "address",
      ]);
      assert.equal("name" in out, false);
    }
  });

  it("falls back to the bare to_addr column when the structured `to` is absent", () => {
    // List rows always carry the structured pair, but a caller mapping something older (or a
    // hand-built row) must still produce a schema-valid single-recipient array.
    const event = toEmailReceivedEvent(detailMessage({
      to: undefined,
    }));
    assert.deepEqual(event.to, [
      {
        address: "support@myapp.ai",
      },
    ]);
  });

  it("carries one `to` entry per event, as the live webhook does", () => {
    const event = toEmailReceivedEvent(detailMessage());
    assert.equal(event.to.length, 1);
    assert.ok(event.to.length >= 1, "the schema requires minItems: 1");
  });
});

describe("toEventAttachment — the fields the schema allows, and only those", () => {
  it("drops contentId and disposition, which the webhook never sends", () => {
    const att = toEventAttachment(detailAttachment());
    assert.equal("contentId" in att, false);
    assert.equal("disposition" in att, false);
    assert.deepEqual(
      Object.keys(att).filter((k) => !EVENT_ATTACHMENT_FIELDS.includes(k)),
      [],
    );
  });

  it("keeps exactly one of url or content", () => {
    const stored = toEventAttachment(detailAttachment());
    assert.equal("url" in stored, true);
    assert.equal("content" in stored, false);

    // Zero-retention / at-rest-encrypted domains store no object, so the bytes are inlined
    // and there is no id to reference.
    const inlined = toEventAttachment({
      filename: "receipt.txt",
      contentType: "text/plain",
      size: 12,
      content: "aGVsbG8gd29ybGQK",
    });
    assert.equal("content" in inlined, true);
    assert.equal("url" in inlined, false);
    assert.equal("id" in inlined, false);
  });

  it("keeps filename and contentType as null rather than omitting them", () => {
    // Both are required by the schema, with an explicit null branch — a part with no name is
    // normal (inline images), a missing key is not.
    const att = toEventAttachment({
      filename: null,
      contentType: null,
      size: 7,
      url: "https://api.mailkite.dev/att/x/0",
    });
    assert.equal(att.filename, null);
    assert.equal(att.contentType, null);
    assert.equal(att.size, 7);
  });

  it("types size as a number", () => {
    assert.equal(toEventAttachment(detailAttachment({
      size: "20481",
    })).size, 20481);
  });
});
