import { describe, expect, it } from "vitest";
import { desktop, DesktopNode } from "../../src/mockups/desktop";
import { WindowNode } from "../../src/mockups/window";

describe("desktop", () => {
  it("creates desktop with wallpaper, menu bar, and windows container", () => {
    const d = desktop({ width: 1920, height: 1080 });
    expect(d).toBeInstanceOf(DesktopNode);
    expect(d.width).toBe(1920);
    expect(d.height).toBe(1080);
    expect(d.menuBar).toBeDefined();
    expect(d.wallpaper).toBeDefined();

    const win = d.add(new WindowNode({ title: "Test", width: 600, height: 400 }));
    expect(win.parent).toBe(d);
  });
});
