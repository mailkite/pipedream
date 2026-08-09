// Tests for the Send Email action's props and payload (AUDIT-2026-08-03 finding A5: the action
// exposed 10 of the send body's fields, and `$summary` always said "Sent" even when the API
// answered `status: "scheduled"`).
//
// Most of what is asserted here is a rule the API imposes that a naive pass-through would break:
//
//   * `parseScheduleTime()` (api/src/index.ts:5642) takes a ms-epoch only as a JSON *number* —
//     a numeric string falls through to `Date.parse()`, which is NaN, which is a 400
//     `bad_schedule`. Pipedream props are strings, so the action converts.
//   * omitted and `false` are different for `trackOpens`/`trackClicks`: omitted reads the
//     domain default (`index.ts:5124-5129`), `false` forces the flag off for this send. A prune
//     on truthiness would silently drop the user's "off".
//   * a future `scheduledAt` returns `{ id: "ssnd_…", status: "scheduled", scheduledAt }`
//     (`index.ts:5116`), not a sent `msg_…`.
//   * the published request schema is `additionalProperties: false`
//     (`sdks/spec/schemas/send-request.json`), so an unknown key is a contract break, not an
//     extra. SCHEMA_FIELDS below mirrors that schema's property list.
//
// The component under test is the one that ships; nothing is stubbed but `@pipedream/platform`
// (test/stub-loader.mjs), whose axios() throws on any real network call.
import assert from "node:assert/strict";
import {
  describe, it,
} from "node:test";

import action, {
  buildSendPayload,
  normalizeHeaders,
  normalizeScheduledAt,
  parseAttachments,
  summarize,
} from "../components/mailkite/actions/send-email/send-email.mjs";

// Every property `sdks/spec/schemas/send-request.json` declares. The schema is
// `additionalProperties: false`, so this is the complete set of legal payload keys.
const SCHEMA_FIELDS = [
  "from",
  "to",
  "subject",
  "html",
  "text",
  "templateId",
  "templateData",
  "cc",
  "bcc",
  "replyTo",
  "inReplyTo",
  "headers",
  "attachments",
  "scheduledAt",
  "trackOpens",
  "trackClicks",
];

/**
 * A fully configured action, as Pipedream binds prop values onto `this`.
 *
 * @param {object} [over={}] - Prop overrides.
 * @returns {object} The bound component stand-in.
 */
function configured(over = {}) {
  return {
    from: "support@myapp.ai",
    to: [
      "ada@example.com",
    ],
    subject: "Your invoice",
    html: "<p>Thanks!</p>",
    text: "Thanks!",
    cc: [
      "billing@myapp.ai",
    ],
    bcc: [
      "archive@myapp.ai",
    ],
    replyTo: "replies@myapp.ai",
    inReplyTo: "<abc@mail.example.com>",
    attachments: [
      {
        filename: "invoice.pdf",
        url: "https://files.myapp.ai/invoice.pdf",
      },
    ],
    headers: {
      "X-Entity-Ref-ID": "inv_412",
    },
    templateId: "tpl_9x",
    templateData: {
      name: "Ada",
    },
    scheduledAt: "2026-09-01T09:00:00Z",
    trackOpens: true,
    trackClicks: false,
    ...over,
  };
}

/** A minimal action: only the two required props are set. */
const MINIMAL = {
  from: "support@myapp.ai",
  to: [
    "ada@example.com",
  ],
  subject: "Hi",
  text: "Hello",
};

describe("props (A5)", () => {
  it("exposes every field the published send-request schema documents", () => {
    const propNames = Object.keys(action.props).filter((p) => p !== "mailkite");
    for (const field of SCHEMA_FIELDS) {
      assert.ok(propNames.includes(field), `no prop for documented send field \`${field}\``);
    }
  });

  it("declares no prop outside that schema", () => {
    // `attribution` is deliberately absent: the API honors it, but it is not in the published
    // request schema (which is additionalProperties: false) and it is ignored on free plans, so
    // a marketplace toggle for it would be undocumented and mostly inert.
    const propNames = Object.keys(action.props).filter((p) => p !== "mailkite");
    for (const p of propNames) {
      assert.ok(SCHEMA_FIELDS.includes(p), `prop \`${p}\` is not a documented send field`);
    }
  });

  it("marks everything but From and To optional", () => {
    for (const [
      name,
      def,
    ] of Object.entries(action.props)) {
      if (name === "mailkite") continue;
      const required = [
        "from",
        "to",
      ].includes(name);
      assert.equal(!def.optional, required, `\`${name}\` optionality is wrong`);
    }
  });

  it("types the new props the way the schema does", () => {
    assert.equal(action.props.inReplyTo.type, "string");
    assert.equal(action.props.attachments.type, "string[]");
    assert.equal(action.props.headers.type, "object");
    assert.equal(action.props.scheduledAt.type, "string");
    assert.equal(action.props.trackOpens.type, "boolean");
    assert.equal(action.props.trackClicks.type, "boolean");
  });
});

describe("buildSendPayload", () => {
  it("carries every configured field through", () => {
    assert.deepEqual(buildSendPayload(configured()), {
      from: "support@myapp.ai",
      to: [
        "ada@example.com",
      ],
      subject: "Your invoice",
      html: "<p>Thanks!</p>",
      text: "Thanks!",
      cc: [
        "billing@myapp.ai",
      ],
      bcc: [
        "archive@myapp.ai",
      ],
      replyTo: "replies@myapp.ai",
      inReplyTo: "<abc@mail.example.com>",
      attachments: [
        {
          filename: "invoice.pdf",
          url: "https://files.myapp.ai/invoice.pdf",
        },
      ],
      headers: {
        "X-Entity-Ref-ID": "inv_412",
      },
      templateId: "tpl_9x",
      templateData: {
        name: "Ada",
      },
      scheduledAt: "2026-09-01T09:00:00Z",
      trackOpens: true,
      trackClicks: false,
    });
  });

  it("emits no key the schema forbids", () => {
    for (const k of Object.keys(buildSendPayload(configured()))) {
      assert.ok(SCHEMA_FIELDS.includes(k), `payload key \`${k}\` is not in send-request`);
    }
  });

  it("omits every unset optional field rather than sending undefined", () => {
    const payload = buildSendPayload(MINIMAL);
    assert.deepEqual(Object.keys(payload).sort(), [
      "from",
      "subject",
      "text",
      "to",
    ]);
    for (const k of Object.keys(payload)) {
      assert.notEqual(payload[k], undefined);
    }
  });

  it("keeps an explicit `false` for the tracking flags", () => {
    // The prune is on `undefined`, not truthiness: dropping `false` would turn "off for this
    // send" into "use the domain default", which may be on.
    const payload = buildSendPayload({
      ...MINIMAL,
      trackOpens: false,
      trackClicks: false,
    });
    assert.equal(payload.trackOpens, false);
    assert.equal(payload.trackClicks, false);
    assert.ok("trackOpens" in payload);
    assert.ok("trackClicks" in payload);
  });

  it("drops an empty CC/BCC array", () => {
    const payload = buildSendPayload({
      ...MINIMAL,
      cc: [],
      bcc: [],
    });
    assert.ok(!("cc" in payload), "an empty CC is an unset prop, not a recipient list");
    assert.ok(!("bcc" in payload));
  });

  it("passes a bare-string recipient through (the API accepts string or array)", () => {
    assert.equal(buildSendPayload({
      ...MINIMAL,
      to: "ada@example.com",
    }).to, "ada@example.com");
  });
});

describe("attachments", () => {
  it("passes an array of objects through untouched", () => {
    const a = [
      {
        filename: "a.pdf",
        url: "https://x/a.pdf",
      },
      {
        filename: "b.txt",
        content: "aGk=",
        contentType: "text/plain",
      },
    ];
    assert.deepEqual(parseAttachments(a), a);
  });

  it("parses entries that arrive as JSON strings", () => {
    assert.deepEqual(parseAttachments([
      "{\"filename\":\"a.pdf\",\"url\":\"https://x/a.pdf\"}",
    ]), [
      {
        filename: "a.pdf",
        url: "https://x/a.pdf",
      },
    ]);
  });

  it("parses the whole prop when it arrives as one JSON string", () => {
    // What an expression like {{steps.trigger.event.attachments}} hands a string[] prop.
    assert.deepEqual(parseAttachments("[{\"filename\":\"a.pdf\",\"content\":\"aGk=\"}]"), [
      {
        filename: "a.pdf",
        content: "aGk=",
      },
    ]);
  });

  it("accepts a single object", () => {
    assert.deepEqual(parseAttachments({
      filename: "a.pdf",
      url: "https://x/a.pdf",
    }), [
      {
        filename: "a.pdf",
        url: "https://x/a.pdf",
      },
    ]);
  });

  it("omits an empty list", () => {
    assert.equal(parseAttachments([]), undefined);
    assert.equal(parseAttachments(undefined), undefined);
    assert.equal(parseAttachments(null), undefined);
  });

  it("skips blank entries left by an unresolved expression", () => {
    assert.deepEqual(parseAttachments([
      "",
      null,
      {
        filename: "a.pdf",
        url: "https://x/a.pdf",
      },
    ]), [
      {
        filename: "a.pdf",
        url: "https://x/a.pdf",
      },
    ]);
  });

  it("rejects an entry with no filename", () => {
    // The API 400s on this; a ConfigurationError names the offending entry instead.
    assert.throws(() => parseAttachments([
      {
        url: "https://x/a.pdf",
      },
    ]), /Attachment 1 is missing `filename`/);
    assert.throws(() => parseAttachments([
      {
        filename: "   ",
        url: "https://x/a.pdf",
      },
    ]), /missing `filename`/);
  });

  it("rejects a non-object entry", () => {
    assert.throws(() => parseAttachments([
      42,
    ]), /must be an object/);
    assert.throws(() => parseAttachments([
      [
        "a.pdf",
      ],
    ]), /must be an object/);
  });

  it("rejects a string that is not JSON", () => {
    assert.throws(() => parseAttachments("invoice.pdf"), /must be valid JSON/);
  });
});

describe("headers", () => {
  it("passes string values through", () => {
    assert.deepEqual(normalizeHeaders({
      "List-Unsubscribe": "<mailto:stop@myapp.ai>",
    }), {
      "List-Unsubscribe": "<mailto:stop@myapp.ai>",
    });
  });

  it("coerces a number or boolean to a string", () => {
    // The API types headers as Record<string, string>; an expression readily yields a number.
    assert.deepEqual(normalizeHeaders({
      "X-Retry": 3,
      "X-Test": true,
    }), {
      "X-Retry": "3",
      "X-Test": "true",
    });
  });

  it("parses an object that arrives as a JSON string", () => {
    assert.deepEqual(normalizeHeaders("{\"X-Tag\":\"invoice\"}"), {
      "X-Tag": "invoice",
    });
  });

  it("drops blank values instead of emitting an empty header", () => {
    assert.deepEqual(normalizeHeaders({
      "X-Tag": "invoice",
      "X-Unset": null,
      "X-Empty": "",
    }), {
      "X-Tag": "invoice",
    });
  });

  it("omits a map with nothing usable left", () => {
    assert.equal(normalizeHeaders({}), undefined);
    assert.equal(normalizeHeaders({
      "X-Unset": null,
    }), undefined);
    assert.equal(normalizeHeaders(undefined), undefined);
  });

  it("rejects a non-scalar value rather than sending [object Object]", () => {
    assert.throws(() => normalizeHeaders({
      "X-Tag": {
        a: 1,
      },
    }), /must be a string — got an object/);
    assert.throws(() => normalizeHeaders({
      "X-Tag": [
        "a",
      ],
    }), /must be a string — got an array/);
  });

  it("rejects an array", () => {
    assert.throws(() => normalizeHeaders([
      "X-Tag",
    ]), /must be an object/);
  });
});

describe("scheduledAt", () => {
  it("converts a ms-epoch string to a number", () => {
    // parseScheduleTime() only takes an epoch as a number — as a string it hits Date.parse(),
    // which is NaN, which the API rejects with `bad_schedule`.
    assert.equal(normalizeScheduledAt("1787216400000"), 1787216400000);
    assert.equal(typeof normalizeScheduledAt("1787216400000"), "number");
  });

  it("leaves an ISO 8601 timestamp as a string", () => {
    assert.equal(normalizeScheduledAt("2026-09-01T09:00:00Z"), "2026-09-01T09:00:00Z");
  });

  it("leaves relative language as a string", () => {
    assert.equal(normalizeScheduledAt("in 2 hours"), "in 2 hours");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(normalizeScheduledAt("  in 2 hours  "), "in 2 hours");
    assert.equal(normalizeScheduledAt(" 1787216400000 "), 1787216400000);
  });

  it("omits an empty value", () => {
    assert.equal(normalizeScheduledAt(""), undefined);
    assert.equal(normalizeScheduledAt("   "), undefined);
    assert.equal(normalizeScheduledAt(undefined), undefined);
    assert.equal(normalizeScheduledAt(null), undefined);
  });

  it("passes a real number through and drops a non-finite one", () => {
    assert.equal(normalizeScheduledAt(1787216400000), 1787216400000);
    assert.equal(normalizeScheduledAt(NaN), undefined);
  });
});

describe("$summary (A5)", () => {
  it("reports a scheduled send as scheduled, with its fire time", () => {
    const s = summarize({
      id: "ssnd_7c",
      status: "scheduled",
      scheduledAt: 1787216400000,
    }, [
      "ada@example.com",
    ]);
    assert.equal(
      s,
      "Scheduled email to ada@example.com for 2026-08-20T09:00:00.000Z (id: ssnd_7c)",
    );
    assert.ok(!s.startsWith("Sent"), "a parked message has not been sent");
  });

  it("reports an immediate send as sent", () => {
    assert.equal(summarize({
      id: "msg_1a",
      status: "sent",
    }, [
      "ada@example.com",
      "bob@example.com",
    ]), "Sent email to ada@example.com, bob@example.com (id: msg_1a)");
  });

  it("names any other status instead of claiming a send", () => {
    assert.equal(summarize({
      id: "msg_1a",
      status: "held",
    }, "ada@example.com"), "Email to ada@example.com accepted with status \"held\" (id: msg_1a)");
  });

  it("survives a scheduled response with no usable time", () => {
    assert.match(summarize({
      id: "ssnd_7c",
      status: "scheduled",
    }, "ada@example.com"), /for a scheduled time/);
  });
});

describe("run()", () => {
  /**
   * Bind the action's own `run` to a `this` whose app method is a stub, the way Pipedream binds
   * it at runtime.
   *
   * @param {object} props - Prop values.
   * @param {object} response - What `sendEmail()` resolves to.
   * @returns {Promise<{result: object, sent: object, summary: string}>} The captured call.
   */
  async function invoke(props, response) {
    let sent;
    let summary;
    const self = {
      ...props,
      mailkite: {
        async sendEmail(opts) {
          sent = opts;
          return response;
        },
      },
    };
    const result = await action.run.call(self, {
      $: {
        export(key, value) {
          if (key === "$summary") summary = value;
        },
      },
    });
    return {
      result,
      sent,
      summary,
    };
  }

  it("posts the built payload and returns the API response", async () => {
    const response = {
      id: "msg_1a",
      status: "sent",
    };
    const {
      result, sent, summary,
    } = await invoke(MINIMAL, response);
    assert.deepEqual(sent.data, buildSendPayload(MINIMAL));
    assert.equal(result, response);
    assert.equal(summary, "Sent email to ada@example.com (id: msg_1a)");
  });

  it("summarizes a scheduled response from the response, not the props", async () => {
    const { summary } = await invoke({
      ...MINIMAL,
      scheduledAt: "in 2 hours",
    }, {
      id: "ssnd_7c",
      status: "scheduled",
      scheduledAt: 1787216400000,
    });
    assert.match(summary, /^Scheduled email to ada@example\.com for 2026-08-20T09:00:00\.000Z/);
  });

  it("fails on bad config before making the request", async () => {
    await assert.rejects(() => invoke({
      ...MINIMAL,
      attachments: [
        {
          url: "https://x/a.pdf",
        },
      ],
    }, {
      id: "msg_1a",
      status: "sent",
    }), /missing `filename`/);
  });
});
