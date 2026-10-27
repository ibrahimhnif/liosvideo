import { describe, expect, it } from "vitest";
import { applyTransition, transition } from "../src/anim/transition";
import { group } from "../src/graph/kinds";

describe("Transitions", () => {
  it("creates transition definition with helper", () => {
    const t = transition("fade", 0.5);
    expect(t.type).toBe("fade");
    expect(t.duration).toBe(0.5);
  });

  it("applies fade transition to node", () => {
    const g = group();
    applyTransition(g, { type: "fade", duration: 1.0 }, 0.5, 1920, 1080);
    expect(g.propsAt(0).opacity).toBeCloseTo(0.5);

    applyTransition(g, { type: "fade", duration: 1.0 }, 1.0, 1920, 1080);
    expect(g.propsAt(0).opacity).toBeCloseTo(1.0);
  });

  it("applies slide transition to node with direction", () => {
    const g = group();
    applyTransition(g, { type: "slide", duration: 1.0, direction: "left" }, 0.5, 1920, 1080);
    expect(g.propsAt(0).x).toBeCloseTo(960);

    const gUp = group();
    applyTransition(gUp, { type: "slide", duration: 1.0, direction: "up" }, 0.5, 1920, 1080);
    expect(gUp.propsAt(0).y).toBeCloseTo(540);
  });

  it("applies zoom transition to node", () => {
    const g = group();
    applyTransition(g, { type: "zoom", duration: 1.0 }, 0.0, 1920, 1080);
    expect(g.propsAt(0).scaleX).toBeCloseTo(0.8);
    expect(g.propsAt(0).opacity).toBeCloseTo(0.0);

    applyTransition(g, { type: "zoom", duration: 1.0 }, 1.0, 1920, 1080);
    expect(g.propsAt(0).scaleX).toBeCloseTo(1.0);
    expect(g.propsAt(0).opacity).toBeCloseTo(1.0);
  });

  it("supports custom transition callback function", () => {
    const g = group();
    const custom = transition((node, progress) => {
      (node as any).base.rotation = progress * 180;
      (node as any).base.scaleX = progress;
    }, 0.8);

    expect(custom.type).toBe("custom");
    expect(custom.duration).toBe(0.8);

    applyTransition(g, custom, 0.5, 1920, 1080);
    expect(g.propsAt(0).rotation).toBeCloseTo(90);
    expect(g.propsAt(0).scaleX).toBeCloseTo(0.5);
  });
});
