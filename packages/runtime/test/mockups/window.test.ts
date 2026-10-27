import { describe, expect, it } from "vitest";
import { WindowNode } from "../../src/mockups/window";

describe("WindowNode", () => {
  it("creates window hierarchy with title bar, traffic lights and content area", () => {
    const win = new WindowNode({ title: "My Window", width: 800, height: 600 });
    expect(win.width).toBe(800);
    expect(win.height).toBe(600);
    expect(win.titleBar).toBeDefined();
    expect(win.trafficLights).toBeDefined();
    expect(win.titleText.propsAt(0).text).toBe("My Window");
    expect(win.contentArea).toBeDefined();
    expect(win.contentArea.propsAt(0).clip).toBe(true);
  });
});
