// Stand-in for `@pipedream/platform`, which only resolves inside Pipedream's own tooling
// (`pd dev` / the registry build) — see the C3 gate in AUDIT-2026-08-03.md. The tests here
// exercise pure local logic (signature verification), so the only thing the real package is
// needed for is satisfying the import in `mailkite.app.mjs`.
//
// It throws rather than returning a mock: any test that reaches the network is a test that
// stopped testing what it claims to, and should fail loudly instead of passing on a fake.
export function axios() {
  throw new Error(
    "@pipedream/platform axios() was called under test — these tests must not make HTTP calls",
  );
}

export default {
  axios,
};
