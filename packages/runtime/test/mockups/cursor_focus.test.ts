import { describe, expect, it } from "vitest";
import { cursor, CursorNode } from "../../src/mockups/cursor";
import { focus } from "../../src/mockups/focus";
import { desktop } from "../../src/mockups/desktop";
import { WindowNode } from "../../src/mockups/window";

describe("cursor & focus", () => {
  it("animates cursor movement and click", () => {
    const c = cursor({ x: 100, y: 100 });
    expect(c).toBeInstanceOf(CursorNode);
    c.moveTo(500, 300, { at: 1.0, duration: 1.0 });
    expect(c.propsAt(1.0).x).toBe(100);
    expect(c.propsAt(2.0).x).toBe(500);
    expect(c.propsAt(2.0).y).toBe(300);
  });

  it("focuses a window while dimming and blurring siblings", () => {
    const d = desktop({ width: 1920, height: 1080 });
    const win1 = d.add(new WindowNode({ title: "Win 1", width: 600, height: 400 }));
    const win2 = d.add(new WindowNode({ title: "Win 2", width: 600, height: 400 }));

    focus(win1, { at: 1.0, duration: 0.5 });
    expect(win1.propsAt(1.5).z).toBeGreaterThan(win2.propsAt(1.5).z);
    expect(win2.propsAt(1.5).opacity).toBeLessThan(1.0);
    expect(win2.propsAt(1.5).blur).toBeGreaterThan(0);
  });
});
