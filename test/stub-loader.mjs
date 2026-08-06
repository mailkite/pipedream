// Module-resolution hook (Node built-in, no dependencies) that points `@pipedream/platform`
// at ./stubs/pipedream-platform.mjs. This is what lets `node --test` import the *real*
// component files rather than a copy of their logic — the component under test is the one
// that ships.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@pipedream/platform") {
    return {
      shortCircuit: true,
      url: new URL("./stubs/pipedream-platform.mjs", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
