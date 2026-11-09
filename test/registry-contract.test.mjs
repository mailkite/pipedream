// The registry-facing contract: the things Pipedream's guidelines and MailKite's published
// payload schema require of these files, asserted so they cannot drift back.
//
// Everything here was found BY drifting: the source key predated the past-tense `-instant`
// convention, the source carried an `annotations` object only actions may declare, and
// `test-event.mjs` had lost `receivedAt`/`receivedAtIso` (audit findings B1, B2, A4).
// Guidelines: pipedream.com/docs/components/contributing/guidelines.

import assert from "node:assert/strict";
import path from "node:path";
import {
  describe, it,
} from "node:test";

import source from "../components/mailkite/sources/email-received-instant/email-received-instant.mjs";
import action from "../components/mailkite/actions/send-email/send-email.mjs";
import listTemplates from "../components/mailkite/actions/list-templates/list-templates.mjs";
import sampleEmit from "../components/mailkite/sources/email-received-instant/test-event.mjs";

const APP = "mailkite";
const SOURCE_DIR = "components/mailkite/sources/email-received-instant";
const ACTION_DIR = "components/mailkite/actions/send-email";
const LIST_TEMPLATES_DIR = "components/mailkite/actions/list-templates";

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

  it("names the List Templates action after its key", () => {
    assertKeyMatchesPath(listTemplates, LIST_TEMPLATES_DIR);
  });
});

describe("action metadata", () => {
  for (const [
    label,
    component,
  ] of [
    [
      "Send Email",
      action,
    ],
    [
      "List Templates",
      listTemplates,
    ],
  ]) {
    it(`declares all three hints on ${label}`, () => {
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

    it(`declares ai: "optimized" on ${label}`, () => {
      // "Every action that is created or modified must declare the top-level property
      // ai: \"optimized\" in its default export."
      assert.equal(component.ai, "optimized");
    });
  }

  it("keeps the source free of annotations", () => {
    // "Source components must NOT include an annotations object."
    assert.equal(source.annotations, undefined);
  });

  it("marks the Send Email action as writing, not read-only", () => {
    assert.equal(action.annotations.readOnlyHint, false);
    assert.equal(action.annotations.destructiveHint, false);
    assert.equal(action.annotations.openWorldHint, true);
  });

  it("marks List Templates as read-only", () => {
    assert.equal(listTemplates.annotations.readOnlyHint, true);
    assert.equal(listTemplates.annotations.destructiveHint, false);
    assert.equal(listTemplates.annotations.openWorldHint, true);
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
      listTemplates,
    ]) {
      assert.match(component.version, /^\d+\.\d+\.\d+$/, `${component.key} version is semver`);
    }
  });
});
