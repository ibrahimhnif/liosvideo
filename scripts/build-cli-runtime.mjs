// Bundles the liosvideo runtime into the IIFE the headless CLI embeds (apps/cli/src/runtime/liosvideo.iife.js).
// Run after changing packages/runtime: `pnpm build:cli-runtime`.
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const bundle = await rolldown({
  input: `${root}packages/runtime/src/index.ts`,
  platform: "neutral",
  // `three` is only imported for types; the CLI loads its own Three.js bundle
  external: ["three"],
});
await bundle.write({
  file: `${root}apps/cli/src/runtime/liosvideo.iife.js`,
  format: "iife",
  name: "__liosvideo",
  footer: "globalThis.__liosvideo = __liosvideo;",
});
await bundle.close();
console.log("wrote apps/cli/src/runtime/liosvideo.iife.js");
