import { describe, expect, it } from "vitest";
import { composition, scene } from "../src/composition";
import { group, rect } from "../src/graph/kinds";
import { buildManifest } from "../src/manifest";

describe("Node.spans", () => {
  it("merges overlapping segments across props", () => {
    const r = rect().to({ x: 10 }, { at: 0, duration: 1 }).to({ opacity: 0 }, { at: 0.5, duration: 1 });
    expect(r.spans()).toEqual([{ start: 0, end: 1.5 }]);
  });

  it("keeps separate segments and instant sets", () => {
    const r = rect().to({ x: 10 }, { at: 0, duration: 1 }).set({ fill: "#000000" }, 2).to({ y: 5 }, { at: 3, duration: 0.5 });
    expect(r.spans()).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 3.5 },
    ]);
  });

  it("is empty for a static node", () => {
    expect(rect().spans()).toEqual([]);
  });
});

const make = () =>
  composition({
    width: 100,
    height: 100,
    fps: 30,
    scenes: [
      scene("a", { duration: 2 }, () => {}),
      scene("b", { duration: 1 }, ({ root }) => {
        const d = root.add(group({ name: "desktop" }));
        d.add(rect({ name: "win" })).to({ x: 1 }, { at: 0.5, duration: 0.5 });
        d.add(rect({ name: "long" })).to({ x: 1 }, { at: 0.5, duration: 5 });
      }),
    ],
  });

describe("buildManifest", () => {
  it("maps scenes, trees and spans to composition frames", () => {
    const m = buildManifest(make());
    expect(m).toMatchObject({ width: 100, height: 100, fps: 30, totalFrames: 90 });
    expect(m.scenes.map((s) => [s.id, s.startFrame, s.endFrame])).toEqual([
      ["a", 0, 60],
      ["b", 60, 90],
    ]);
    const b = m.scenes[1].tree;
    expect(b).toMatchObject({ path: "b", name: "b", kind: "group" });
    const [win, long] = b.children[0].children;
    expect(b.children[0].path).toBe("b/desktop");
    expect(win).toMatchObject({ path: "b/desktop/win", kind: "rect", spans: [{ startFrame: 75, endFrame: 90 }] });
    expect(long.spans).toEqual([{ startFrame: 75, endFrame: 90 }]);
  });

  it("handles empty compositions and scenes", () => {
    expect(buildManifest(composition({ width: 1, height: 1, fps: 30, scenes: [] }))).toMatchObject({ scenes: [], totalFrames: 0 });
    expect(buildManifest(make()).scenes[0].tree.children).toEqual([]);
  });

  it("is deterministic", () => {
    expect(buildManifest(make())).toEqual(buildManifest(make()));
  });
});
