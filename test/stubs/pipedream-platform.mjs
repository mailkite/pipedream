// Stand-in for `@pipedream/platform`, which only resolves inside Pipedream's own tooling
// (`pd dev` / the registry build) — see the C3 gate in AUDIT-2026-08-03.md. The tests here
// exercise pure local logic (signature verification, payload building), so the only thing the
// real package is needed for is satisfying the imports in the component files.
//
// `axios` throws rather than returning a mock: any test that reaches the network is a test that
// stopped testing what it claims to, and should fail loudly instead of passing on a fake.
export function axios() {
  throw new Error(
    "@pipedream/platform axios() was called under test — these tests must not make HTTP calls",
  );
}

// The real ConfigurationError is the platform's "the user configured this step wrong" error,
// rendered to the user instead of as a crash. Only its identity and message matter locally, so
// this is a plain named Error subclass with the same shape.
export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export default {
  axios,
  ConfigurationError,
};
