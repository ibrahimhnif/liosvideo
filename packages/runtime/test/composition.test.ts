import { describe, expect, it, vi } from "vitest";
import { clampFrame, composition, instantiateScene, layoutComposition, scene } from "../src/composition";

const twoScenes = () =>
  composition({
    width: 1920,
    height: 1080,
    fps: 30,
    scenes: [scene("a", { duration: 2 }, () => {}), scene("b", { duration: 1.5 }, () => {})],
  });

describe("layoutComposition", () => {
  it("lays scenes out sequentially in frames", () => {
    expect(layoutComposition(twoScenes())).toEqual({
      totalFrames: 105,
      scenes: [
        { id: "a", startFrame: 0, endFrame: 60 },
        { id: "b", startFrame: 60, endFrame: 105 },
      ],
    });
  });

  it("rejects duplicate scene ids", () => {
    const c = composition({ width: 10, height: 10, fps: 30, scenes: [scene("a", { duration: 1 }, () => {}), scene("a", { duration: 1 }, () => {})] });
    expect(() => layoutComposition(c)).toThrow('Duplicate scene id "a"');
  });

  it("defaults background to black", () => {
    expect(twoScenes().background).toBe("#000000");
  });
});

describe("clampFrame", () => {
  it("clamps into the composition", () => {
    const c = twoScenes();
    expect(clampFrame(c, -5)).toBe(0);
    expect(clampFrame(c, 999)).toBe(104);
  });

  it("clamps to 0 for an empty composition", () => {
    const c = composition({ width: 100, height: 100, fps: 30, scenes: [] });
    expect(layoutComposition(c).totalFrames).toBe(0);
    expect(clampFrame(c, 10)).toBe(0);
  });
});

describe("instantiateScene", () => {
  it("builds once and caches the root", () => {
    const build = vi.fn();
    const def = scene("s", { duration: 1 }, build);
    const c = composition({ width: 640, height: 360, fps: 30, scenes: [def] });
    const r1 = instantiateScene(c, def);
    const r2 = instantiateScene(c, def);
    expect(r1).toBe(r2);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("passes a sized root named after the scene and a seeded random", () => {
    let seen: { name: string; w: number; h: number; dur: number; r: number } | undefined;
    const def = scene("intro", { duration: 3 }, (ctx) => {
      seen = { name: ctx.root.name, w: ctx.width, h: ctx.height, dur: ctx.duration, r: ctx.random() };
      expect(ctx.root.propsAt(0)).toMatchObject({ width: 640, height: 360 });
    });
    instantiateScene(composition({ width: 640, height: 360, fps: 30, scenes: [def] }), def);
    const again = scene("intro", { duration: 3 }, (ctx) => expect(ctx.random()).toBe(seen!.r));
    instantiateScene(composition({ width: 640, height: 360, fps: 30, scenes: [again] }), again);
    expect(seen).toMatchObject({ name: "intro", w: 640, h: 360, dur: 3 });
  });
});
