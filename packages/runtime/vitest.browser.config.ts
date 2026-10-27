import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/gpu/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      // headless Chromium on macOS uses Metal
      provider: playwright({ launchOptions: { args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
