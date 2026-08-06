// Registers the resolution hook for every test file. Wired via `--import` in `npm test`.
import { register } from "node:module";

register("./stub-loader.mjs", import.meta.url);
