// Tests for the List Templates action — the companion that makes Send Email's `templateId`
// discoverable. The component under test is the file that ships; the app methods are stubs.
import assert from "node:assert/strict";
import {
  describe, it,
} from "node:test";

import action from "../components/mailkite/actions/list-templates/list-templates.mjs";

/**
 * Bind `run()` to a `this` whose app methods return fixed rows.
 *
 * @param {object} [opts] - Harness options.
 * @param {object[]} [opts.saved] - Rows from `GET /api/templates`.
 * @param {object[]} [opts.base] - Rows from `GET /api/templates/base`.
 * @param {boolean} [opts.includeBase] - The action prop.
 * @returns {object} The run result plus the exported summary and the calls made.
 */
async function run({
  saved = [], base = [], includeBase = undefined,
} = {}) {
  const calls = [];
  let summary;
  const ctx = {
    includeBase,
    mailkite: {
      listTemplates: async (args) => {
        calls.push({
          op: "listTemplates",
          args,
        });
        return saved;
      },
      listBaseTemplates: async (args) => {
        calls.push({
          op: "listBaseTemplates",
          args,
        });
        return base;
      },
    },
  };
  const result = await action.run.call(ctx, {
    $: {
      export: (name, value) => {
        assert.equal(name, "$summary");
        summary = value;
      },
    },
  });
  return {
    result,
    summary,
    calls,
  };
}

const SAVED = {
  id: "tpl_4f3c9a",
  name: "Receipt",
  category: "billing",
  subject: "Your receipt",
  is_base: 0,
  updated_at: 1785196800000,
};

const BASE = {
  id: "base_1a2b3c",
  name: "Welcome",
  category: "onboarding",
  subject: "Welcome aboard",
  is_base: 1,
  updated_at: 1785196800000,
};

describe("List Templates", () => {
  it("returns saved and base templates in the Send Email id shape", async () => {
    const {
      result,
    } = await run({
      saved: [
        SAVED,
      ],
      base: [
        BASE,
      ],
    });
    assert.deepEqual(result, [
      {
        id: "tpl_4f3c9a",
        name: "Receipt",
        category: "billing",
        subject: "Your receipt",
        isBase: false,
        updatedAt: 1785196800000,
      },
      {
        id: "base_1a2b3c",
        name: "Welcome",
        category: "onboarding",
        subject: "Welcome aboard",
        isBase: true,
        updatedAt: 1785196800000,
      },
    ]);
  });

  it("omits base templates when includeBase is false", async () => {
    const {
      result, calls,
    } = await run({
      saved: [
        SAVED,
      ],
      base: [
        BASE,
      ],
      includeBase: false,
    });
    assert.deepEqual(result.map((t) => t.id), [
      "tpl_4f3c9a",
    ]);
    assert.equal(calls.some((c) => c.op === "listBaseTemplates"), false);
  });

  it("exports a singular summary for one template", async () => {
    const {
      summary,
    } = await run({
      saved: [
        SAVED,
      ],
      includeBase: false,
    });
    assert.equal(summary, "Found 1 template");
  });

  it("exports a plural summary otherwise", async () => {
    const {
      summary,
    } = await run({
      saved: [
        SAVED,
      ],
      base: [
        BASE,
      ],
    });
    assert.equal(summary, "Found 2 templates");
  });
});
