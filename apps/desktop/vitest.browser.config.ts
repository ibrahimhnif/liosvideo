import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) } },
  test: {
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      // full Chromium ("new headless"): the headless shell breaks WebGPU after a worker presents a frame
      provider: playwright({ launchOptions: { channel: "chromium", args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
