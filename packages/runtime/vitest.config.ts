import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // example projects (examples/style-lab) import the runtime by its package name
  resolve: { alias: { liosvideo: fileURLToPath(new URL("./src/index.ts", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"], exclude: ["test/**/*.browser.test.ts"] },
});
