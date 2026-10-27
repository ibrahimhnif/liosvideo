import { describe, expect, it } from "vitest";
import { chrome, ChromeNode } from "../../src/mockups/chrome";

describe("chrome", () => {
  it("creates a Chrome browser with tab strip and omnibox typing", () => {
    const web = chrome({ url: "https://example.com", title: "Example Domain", width: 1000, height: 700 });
    expect(web).toBeInstanceOf(ChromeNode);
    expect(web.tabTitle.propsAt(0).text).toBe("Example Domain");

    web.urlbar.type("https://github.com", { at: 1.0, duration: 1.0 });
    const mid = web.urlbar.textAt(1.5);
    expect(mid.length).toBeGreaterThan(0);
    expect(web.urlbar.textAt(2.0)).toBe("https://github.com");
  });
});
