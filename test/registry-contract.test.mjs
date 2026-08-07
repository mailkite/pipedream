// The registry-facing contract: the things Pipedream's guidelines and MailKite's published
// payload schema require of these files, asserted so they cannot drift back.
//
// Everything here was found BY drifting: the source key predated the past-tense `-instant`
// convention, the source shipped without `annotations`, and `test-event.mjs` had lost
// `receivedAt`/`receivedAtIso` (audit findings B1, B2, A4). Guidelines:
// pipedream.com/docs/components/contributing/guidelines.

import assert from "node:assert/strict";
import path from "node:path";
import {
  describe, it,
} from "node:test";

import source from "../components/mailkite/sources/email-received-instant/email-received-instant.mjs";
import action from "../components/mailkite/actions/send-email/send-email.mjs";
import sampleEmit from "../components/mailkite/sources/email-received-instant/test-event.mjs";

const APP = "mailkite";
const SOURCE_DIR = "components/mailkite/sources/email-received-instant";
const ACTION_DIR = "components/mailkite/actions/send-email";

/**
 * Assert a component's key matches the folder and file it lives in — "the name of the folder
 * and the name of the js file equivalent to the slugified component name", with the app slug
 * prefixed onto the key.
 *
 * @param {object} component - The imported component.
 * @param {string} dir - Repo-relative directory the component lives in.
 */
function assertKeyMatchesPath(component, dir) {
  const slug = path.basename(dir);
  assert.equal(
    component.key,
    `${APP}-${slug}`,
    `key must be "${APP}-<folder>"; folder is "${slug}"`,
  );
}

describe("component keys (B1)", () => {
  it("names the source folder and file after its key", () => {
    assertKeyMatchesPath(source, SOURCE_DIR);
  });

  it("uses the past-tense, -instant key form for the webhook source", () => {
    // "Source keys should use past tense verbs that describe the event that occurred
    // (e.g. linear_app-issue-created-instant)."
    assert.equal(source.key, "mailkite-email-received-instant");
    assert.ok(source.key.endsWith("-instant"), "a webhook source key ends in -instant");
    // The *display* name follows the separate "(Instant)" naming rule and is unaffected.
    assert.equal(source.name, "New Inbound Email (Instant)");
  });

  it("names the action folder and file after its key", () => {
    assertKeyMatchesPath(action, ACTION_DIR);
  });
});

describe("annotations (B2)", () => {
  for (const [
    label,
    component,
  ] of [
    [
      "source",
      source,
    ],
    [
      "action",
      action,
    ],
  ]) {
    it(`declares all three hints on the ${label}`, () => {
      const a = component.annotations;
      assert.ok(a, `${label} has an annotations object`);
      for (const hint of [
        "destructiveHint",
        "openWorldHint",
        "readOnlyHint",
      ]) {
        assert.equal(typeof a[hint], "boolean", `${hint} is a boolean`);
      }
    });
  }

  it("declares the source as writing, not read-only", () => {
    // activate()/deactivate() PUT the domain's catch-all webhook route, so the source is not
    // read-only — but it restores the incumbent instead of dropping it, so not destructive.
    assert.equal(source.annotations.readOnlyHint, false);
    assert.equal(source.annotations.destructiveHint, false);
    assert.equal(source.annotations.openWorldHint, true);
  });
});

describe("sample event vs. the published payload contract (A4)", () => {
  // Mirrors sdks/spec/schemas/email-received-event.json — the contract MailKite publishes and
  // `buildWebhookPayload()` builds. Pipedream renders test-event.mjs as the shape users write
  // their workflows against, so a field missing here is a field missing from every user's code.
  const REQUIRED = [
    "id",
    "type",
    "from",
    "to",
    "receivedAt",
    "receivedAtIso",
    "auth",
    "attachments",
  ];
  const OPTIONAL = [
    "subject",
    "text",
    "html",
    "threadId",
  ];

  it("carries every required field", () => {
    for (const field of REQUIRED) {
      assert.ok(field in sampleEmit, `sample is missing required field \`${field}\``);
    }
  });

  it("invents no field the schema forbids", () => {
    // The schema is additionalProperties: false — a field here that the API never sends is
    // just as misleading as a missing one.
    const allowed = new Set([
      ...REQUIRED,
      ...OPTIONAL,
    ]);
    const extra = Object.keys(sampleEmit).filter((k) => !allowed.has(k));
    assert.deepEqual(extra, [], `sample has fields the contract does not define: ${extra}`);
  });

  it("is an email.received event", () => {
    assert.equal(sampleEmit.type, "email.received");
    assert.match(sampleEmit.id, /^msg_/);
  });

  it("renders receivedAtIso as the same instant as receivedAt", () => {
    assert.equal(typeof sampleEmit.receivedAt, "number");
    assert.equal(
      sampleEmit.receivedAtIso,
      new Date(sampleEmit.receivedAt).toISOString(),
      "receivedAtIso must be the RFC 3339 rendering of receivedAt, not a different instant",
    );
  });

  it("shows addresses in the { address, name } shape", () => {
    assert.equal(typeof sampleEmit.from.address, "string");
    assert.ok(Array.isArray(sampleEmit.to) && sampleEmit.to.length >= 1);
    for (const addr of [
      sampleEmit.from,
      ...sampleEmit.to,
    ]) {
      assert.equal(typeof addr.address, "string");
      // `name` rides along only when the MIME header names this same address, and is omitted
      // — never null — when it does not.
      assert.notEqual(addr.name, null);
    }
  });

  it("scores all four auth verdicts", () => {
    assert.deepEqual(Object.keys(sampleEmit.auth).sort(), [
      "dkim",
      "dmarc",
      "spam",
      "spf",
    ]);
  });

  it("shows an attachment carrying exactly one of url or content", () => {
    assert.ok(Array.isArray(sampleEmit.attachments));
    for (const att of sampleEmit.attachments) {
      assert.equal(typeof att.filename, "string");
      assert.equal(typeof att.contentType, "string");
      assert.equal(typeof att.size, "number");
      assert.equal(
        ("url" in att) !== ("content" in att),
        true,
        "each attachment has a signed `url` OR inlined base64 `content`, never both",
      );
    }
  });
});

describe("versioning (B5)", () => {
  it("keeps component versions as semver strings", () => {
    for (const component of [
      source,
      action,
    ]) {
      assert.match(component.version, /^\d+\.\d+\.\d+$/, `${component.key} version is semver`);
    }
  });
});
