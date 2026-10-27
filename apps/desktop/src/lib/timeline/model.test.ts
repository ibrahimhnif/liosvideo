import type { ManifestNode, TimelineManifest } from "liosvideo";
import { describe, expect, it } from "vitest";
import { frameAtX, MIN_MARKER_PX, reconcileSelection, selectionFor, selectionLabel, spanToPx, visibleRows } from "./model";

const node = (path: string, children: ManifestNode[] = [], spans: ManifestNode["spans"] = []): ManifestNode => ({
  path, name: path.split("/").at(-1)!, kind: children.length ? "group" : "rect", spans, children,
});

const manifest = (): TimelineManifest => ({
  width: 100, height: 100, fps: 30, totalFrames: 90,
  scenes: [
    { id: "a", startFrame: 0, endFrame: 60, tree: node("a", [node("a/desktop", [node("a/desktop/win", [], [{ startFrame: 10, endFrame: 20 }]), node("a/desktop/term", [], [{ startFrame: 30, endFrame: 30 }])])]) },
    { id: "b", startFrame: 60, endFrame: 90, tree: node("b") },
  ],
});

describe("visibleRows", () => {
  it("shows only scene rows when collapsed", () => {
    expect(visibleRows(manifest(), new Set()).map((r) => [r.key, r.depth, r.expandable, r.spans])).toEqual([
      ["a", 0, true, [{ startFrame: 0, endFrame: 60 }]],
      ["b", 0, false, [{ startFrame: 60, endFrame: 90 }]],
    ]);
  });

  it("flattens expanded subtrees under their scene", () => {
    const rows = visibleRows(manifest(), new Set(["a", "a/desktop"]));
    expect(rows.map((r) => [r.label, r.depth, r.expanded])).toEqual([
      ["a", 0, true], ["desktop", 1, true], ["win", 2, false], ["term", 2, false], ["b", 0, false],
    ]);
    expect(rows[2]).toMatchObject({ sceneId: "a", path: "a/desktop/win" });
  });

  it("does not walk collapsed subtrees of large trees", () => {
    let deep = node("s/n499");
    for (let i = 498; i >= 0; i--) deep = node(`s/n${i}`, [deep]);
    const m: TimelineManifest = { width: 1, height: 1, fps: 30, totalFrames: 30, scenes: [{ id: "s", startFrame: 0, endFrame: 30, tree: node("s", [deep]) }] };
    expect(visibleRows(m, new Set())).toHaveLength(1);
  });

  it("is empty for an empty manifest", () => {
    expect(visibleRows({ width: 1, height: 1, fps: 30, totalFrames: 0, scenes: [] }, new Set())).toEqual([]);
  });
});

describe("layout", () => {
  it("maps spans to pixels", () => {
    expect(spanToPx({ startFrame: 30, endFrame: 60 }, 90, 900)).toEqual({ x: 300, width: 300 });
  });

  it("keeps instant changes visible", () => {
    expect(spanToPx({ startFrame: 30, endFrame: 30 }, 90, 900).width).toBe(MIN_MARKER_PX);
    expect(MIN_MARKER_PX).toBe(3);
  });

  it("clamps clicks to the composition", () => {
    expect(frameAtX(-10, 100, 90)).toBe(0);
    expect(frameAtX(9999, 100, 90)).toBe(89);
    expect(frameAtX(50, 100, 90)).toBe(45);
  });
});

describe("selection", () => {
  const m = manifest();
  const rows = visibleRows(m, new Set(["a", "a/desktop"]));

  it("selects a scene with its range", () => {
    expect(selectionFor(rows[4], "long.ts", m)).toEqual({ composition: "long.ts", sceneId: "b", startFrame: 60, endFrame: 90 });
  });

  it("selects a node with the union of its and its descendants' spans", () => {
    expect(selectionFor(rows[1], "long.ts", m)).toEqual({ composition: "long.ts", sceneId: "a", path: "a/desktop", startFrame: 10, endFrame: 30 });
  });

  it("falls back to the scene range for a static node", () => {
    const static_: TimelineManifest = { ...m, scenes: [{ ...m.scenes[0], tree: node("a", [node("a/still")]) }] };
    const row = visibleRows(static_, new Set(["a"]))[1];
    expect(selectionFor(row, "long.ts", static_)).toMatchObject({ path: "a/still", startFrame: 0, endFrame: 60 });
  });

  it("clears selections of another composition (they could dangle unseen)", () => {
    const sel = { composition: "short.ts", sceneId: "a", startFrame: 0, endFrame: 1 };
    expect(reconcileSelection(sel, "long.ts", m)).toBeUndefined();
  });

  it("refreshes a selection whose node still exists", () => {
    const sel = { composition: "long.ts", sceneId: "a", path: "a/desktop/win", startFrame: 0, endFrame: 0 };
    expect(reconcileSelection(sel, "long.ts", m)).toMatchObject({ path: "a/desktop/win", startFrame: 10, endFrame: 20 });
  });

  it("falls back to the scene when the node was renamed", () => {
    const sel = { composition: "long.ts", sceneId: "a", path: "a/desktop/terminal", startFrame: 0, endFrame: 0 };
    expect(reconcileSelection(sel, "long.ts", m)).toEqual({ composition: "long.ts", sceneId: "a", startFrame: 0, endFrame: 60 });
  });

  it("clears the selection when the scene is gone", () => {
    expect(reconcileSelection({ composition: "long.ts", sceneId: "gone", startFrame: 0, endFrame: 1 }, "long.ts", m)).toBeUndefined();
  });

  it("labels selections relative to the scene", () => {
    expect(selectionLabel({ composition: "long.ts", sceneId: "a", path: "a/desktop/term", startFrame: 0, endFrame: 0 })).toBe("long.ts › a › desktop/term");
    expect(selectionLabel({ composition: "long.ts", sceneId: "b", startFrame: 0, endFrame: 0 })).toBe("long.ts › b");
  });
});

describe("scene files in selections", () => {
  const withSources = (): TimelineManifest => {
    const m = manifest();
    m.scenes[0].source = "scenes/a.ts";
    return m;
  };

  it("selectionFor carries the scene's source file", () => {
    const m = withSources();
    const rows = visibleRows(m, new Set(["a"]));
    expect(selectionFor(rows[0], "long.ts", m).sceneFile).toBe("scenes/a.ts");
    expect(selectionFor(rows[1], "long.ts", m).sceneFile).toBe("scenes/a.ts");
    expect(selectionFor(rows.at(-1)!, "long.ts", m).sceneFile).toBeUndefined();
  });

  it("reconcileSelection refreshes the source file", () => {
    const sel = { composition: "long.ts", sceneId: "a", path: "a/desktop", startFrame: 0, endFrame: 0 };
    expect(reconcileSelection(sel, "long.ts", withSources())?.sceneFile).toBe("scenes/a.ts");
  });
});
