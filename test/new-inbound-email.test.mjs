// Tests for the inbound-email source's signature gate (AUDIT-2026-08-03 findings C1 + A2).
//
// These import the component that actually ships — `@pipedream/platform` is swapped for a
// throwing stub by test/stub-loader.mjs, so nothing here touches the network or needs a
// Pipedream account (the C3 gate). Everything under test is pure local logic.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  describe, it, mock,
} from "node:test";

import source, { FRESHNESS_MS } from "../components/mailkite/sources/new-inbound-email/new-inbound-email.mjs";
import sampleEmit from "../components/mailkite/sources/new-inbound-email/test-event.mjs";

const SECRET = "whsec_0123456789abcdef0123456789abcdef";

/**
 * Sign a body exactly the way the MailKite API signs an outbound delivery:
 * `signPayload()` (api/src/lib/signing.ts) HMACs `"<t>.<body>"` and `deliverWebhook()`
 * ships it as `x-mailkite-signature: t=<ms>,v1=<hex>` (api/src/index.ts). Reimplemented
 * here rather than imported so the test asserts against the wire contract, not against the
 * component's own idea of it.
 *
 * @param {string} body - Raw request body, exactly as it goes on the wire.
 * @param {object} [opts] - Overrides.
 * @param {number} [opts.t] - Signing timestamp in ms since the epoch.
 * @param {string} [opts.secret] - Signing secret.
 * @returns {{header: string, t: number, v1: string}} The header and its parts.
 */
function sign(body, {
  t = Date.now(), secret = SECRET,
} = {}) {
  const v1 = crypto.createHmac("sha256", secret)
    .update(`${t}.${body}`)
    .digest("hex");
  return {
    header: `t=${t},v1=${v1}`,
    t,
    v1,
  };
}

const {
  verifySignature,
} = source.methods;
const RAW = JSON.stringify(sampleEmit);

describe("verifySignature — authenticity", () => {
  it("accepts a signature produced the way the API produces one", () => {
    const { header } = sign(RAW);
    assert.equal(verifySignature(SECRET, header, RAW), true);
  });

  it("rejects a tampered body", () => {
    const { header } = sign(RAW);
    const tampered = JSON.stringify({
      ...sampleEmit,
      from: {
        address: "attacker@evil.example",
      },
    });
    assert.equal(verifySignature(SECRET, header, tampered), false);
  });

  it("rejects a body that differs by a single byte", () => {
    const { header } = sign(RAW);
    assert.equal(verifySignature(SECRET, header, `${RAW} `), false);
  });

  it("rejects a signature made with a different secret", () => {
    const { header } = sign(RAW, {
      secret: "whsec_someone_elses_secret",
    });
    assert.equal(verifySignature(SECRET, header, RAW), false);
  });

  it("rejects a signature lifted onto a different timestamp", () => {
    // `t` is inside the MAC, so re-labelling a captured signature with a fresh `t` — the
    // obvious way to walk a stale delivery past the freshness window — must not verify.
    const { v1 } = sign(RAW, {
      t: Date.now() - 60_000,
    });
    assert.equal(verifySignature(SECRET, `t=${Date.now()},v1=${v1}`, RAW), false);
  });

  it("ignores unknown parts in the header", () => {
    const { header } = sign(RAW);
    assert.equal(verifySignature(SECRET, `${header},v0=whatever`, RAW), true);
  });

  it("tolerates whitespace around the parts", () => {
    const {
      t, v1,
    } = sign(RAW);
    assert.equal(verifySignature(SECRET, `t=${t}, v1=${v1} `, RAW), true);
  });
});

describe("verifySignature — malformed input", () => {
  const cases = [
    [
      "missing header (undefined)",
      undefined,
    ],
    [
      "missing header (null)",
      null,
    ],
    [
      "empty header",
      "",
    ],
    [
      "non-string header",
      12345,
    ],
    [
      "no key=value pairs at all",
      "garbage",
    ],
    [
      "missing v1",
      `t=${Date.now()}`,
    ],
    [
      "missing t",
      `v1=${sign(RAW).v1}`,
    ],
    [
      "empty t",
      `t=,v1=${sign(RAW).v1}`,
    ],
    [
      "non-numeric t",
      `t=yesterday,v1=${sign(RAW).v1}`,
    ],
    [
      "v1 is not hex",
      `t=${Date.now()},v1=zzzz`,
    ],
    [
      "v1 is truncated",
      `t=${Date.now()},v1=${sign(RAW).v1.slice(0, 32)}`,
    ],
  ];

  for (const [
    name,
    header,
  ] of cases) {
    it(`rejects: ${name}`, () => {
      assert.equal(verifySignature(SECRET, header, RAW), false);
    });
  }
});

describe("verifySignature — freshness window (A2)", () => {
  it("rejects a delivery replayed after the window", () => {
    const { header } = sign(RAW, {
      t: Date.now() - FRESHNESS_MS - 1_000,
    });
    assert.equal(verifySignature(SECRET, header, RAW), false);
  });

  it("accepts a delivery inside the window", () => {
    const { header } = sign(RAW, {
      t: Date.now() - (FRESHNESS_MS - 30_000),
    });
    assert.equal(verifySignature(SECRET, header, RAW), true);
  });

  it("rejects a timestamp far in the future", () => {
    const { header } = sign(RAW, {
      t: Date.now() + FRESHNESS_MS + 1_000,
    });
    assert.equal(verifySignature(SECRET, header, RAW), false);
  });

  it("checks both edges of the window exactly", (t) => {
    const now = 1_770_000_000_000;
    t.mock.timers.enable({
      apis: [
        "Date",
      ],
      now,
    });
    const atEdge = sign(RAW, {
      t: now - FRESHNESS_MS,
    });
    const pastEdge = sign(RAW, {
      t: now - FRESHNESS_MS - 1,
    });
    assert.equal(verifySignature(SECRET, atEdge.header, RAW), true, "exactly at the window");
    assert.equal(verifySignature(SECRET, pastEdge.header, RAW), false, "1ms past the window");
  });

  it("skips the freshness check when the tolerance is 0", () => {
    const { header } = sign(RAW, {
      t: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    assert.equal(verifySignature(SECRET, header, RAW), false, "rejected under the default window");
    assert.equal(verifySignature(SECRET, header, RAW, 0), true, "accepted with the check disabled");
  });

  it("defaults to the 5-minute window the SDKs enforce", () => {
    assert.equal(FRESHNESS_MS, 5 * 60 * 1000);
  });
});

/**
 * Build a `this` for `run()` out of the component's own props and methods, the way Pipedream
 * binds them at runtime.
 *
 * @param {object} [opts] - Prop overrides.
 * @param {string} [opts.ackMode] - `lenient` or `ack`.
 * @param {string} [opts.webhookSecret] - The override prop.
 * @param {object} [opts.db] - Seed values for `$.service.db`.
 * @returns {{run: Function, emitted: Array, responses: Array}} Harness.
 */
function harness({
  ackMode = "lenient", webhookSecret = undefined, db = {},
} = {}) {
  const emitted = [];
  const responses = [];
  const ctx = {
    ...source.methods,
    ackMode,
    webhookSecret,
    db: {
      get: (k) => db[k],
      set: (k, v) => {
        db[k] = v;
      },
    },
    http: {
      endpoint: "https://example.m.pipedream.net",
      respond: (r) => responses.push(r),
    },
    $emit: (payload, meta) => emitted.push({
      payload,
      meta,
    }),
  };
  return {
    run: (event) => source.run.call(ctx, event),
    emitted,
    responses,
  };
}

/**
 * A delivery event shaped like `$.interface.http` hands it over.
 *
 * @param {object} [opts] - Overrides.
 * @param {object} [opts.body] - Parsed payload.
 * @param {string} [opts.header] - `x-mailkite-signature` value; omit for none.
 * @returns {object} The event.
 */
function delivery({
  body = sampleEmit, header,
} = {}) {
  const bodyRaw = JSON.stringify(body);
  return {
    body,
    bodyRaw,
    headers: header === undefined
      ? {}
      : {
        "x-mailkite-signature": header,
      },
  };
}

describe("run() — the verification gate", () => {
  it("emits a verified delivery, using the secret persisted at activate()", async () => {
    const h = harness({
      db: {
        signingSecret: SECRET,
      },
    });
    const event = delivery({
      header: sign(RAW).header,
    });
    await h.run(event);

    assert.equal(h.emitted.length, 1);
    assert.equal(h.emitted[0].payload.id, sampleEmit.id);
    assert.equal(h.emitted[0].meta.id, sampleEmit.id, "dedupe key is the message id");
    assert.match(h.emitted[0].meta.summary, /alice@example\.com/);
  });

  it("prefers the override prop over the persisted secret", async () => {
    const rotated = "whsec_rotated_in_the_dashboard";
    const h = harness({
      webhookSecret: rotated,
      db: {
        signingSecret: SECRET,
      },
    });
    await h.run(delivery({
      header: sign(RAW, {
        secret: rotated,
      }).header,
    }));
    assert.equal(h.emitted.length, 1);

    // ...and the now-stale persisted secret no longer verifies anything.
    const stale = harness({
      webhookSecret: rotated,
      db: {
        signingSecret: SECRET,
      },
    });
    mock.method(console, "log", () => {});
    await stale.run(delivery({
      header: sign(RAW).header,
    }));
    mock.restoreAll();
    assert.equal(stale.emitted.length, 0);
  });

  it("drops a delivery with a bad signature but still answers 200", async () => {
    const h = harness({
      db: {
        signingSecret: SECRET,
      },
    });
    mock.method(console, "log", () => {});
    await h.run(delivery({
      header: sign(RAW, {
        secret: "whsec_wrong",
      }).header,
    }));
    mock.restoreAll();

    assert.equal(h.emitted.length, 0, "unverified events never reach the workflow");
    assert.equal(h.responses.length, 1, "MailKite is still answered, so it stops retrying");
    assert.equal(h.responses[0].status, 200);
    assert.equal(h.responses[0].body, "ok");
  });

  it("drops a replayed delivery (A2, end to end)", async () => {
    const h = harness({
      db: {
        signingSecret: SECRET,
      },
    });
    const captured = delivery({
      header: sign(RAW, {
        t: Date.now() - FRESHNESS_MS - 1_000,
      }).header,
    });
    mock.method(console, "log", () => {});
    await h.run(captured);
    mock.restoreAll();
    assert.equal(h.emitted.length, 0);
  });

  it("drops a delivery with no signature header at all", async () => {
    const h = harness({
      db: {
        signingSecret: SECRET,
      },
    });
    mock.method(console, "log", () => {});
    await h.run(delivery());
    mock.restoreAll();
    assert.equal(h.emitted.length, 0);
  });

  it("emits only inbound mail, not other event types", async () => {
    const h = harness({
      db: {
        signingSecret: SECRET,
      },
    });
    const body = {
      ...sampleEmit,
      type: "email.delivered",
    };
    await h.run(delivery({
      body,
      header: sign(JSON.stringify(body)).header,
    }));
    assert.equal(h.emitted.length, 0);
  });

  it("acknowledges explicitly in ack mode", async () => {
    const h = harness({
      ackMode: "ack",
      db: {
        signingSecret: SECRET,
      },
    });
    await h.run(delivery({
      header: sign(RAW).header,
    }));

    assert.equal(h.responses[0].status, 200);
    assert.deepEqual(h.responses[0].body, {
      status: "ok",
    });
    assert.equal(h.emitted.length, 1);
  });
});
