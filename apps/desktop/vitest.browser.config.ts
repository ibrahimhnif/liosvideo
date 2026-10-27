import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
