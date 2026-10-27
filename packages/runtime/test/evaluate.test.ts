import { describe, expect, it } from "vitest";
import { composition, scene } from "../src/composition";
import { collectAssets, evaluateFrame } from "../src/evaluate";
import { group, image, rect } from "../src/graph/kinds";
import type { LayerItem, RectItem } from "../src/renderlist";

const comp = (build: Parameters<typeof scene>[2], extra: Parameters<typeof scene>[1] = { duration: 2 }) =>
  composition({ width: 320, height: 180, fps: 30, scenes: [scene("s", extra, build)] });

describe("evaluateFrame", () => {
  it("moves children with an animated parent", () => {
    const c = comp(({ root }) => {
      const g = root.add(group({ name: "g" })).to({ x: 100 }, { at: 0, duration: 2, ease: "linear" });
      g.add(rect({ x: 5, width: 10, height: 10 }));
    });
    const item = evaluateFrame(c, 30).items[0] as RectItem;
    expect(item.kind).toBe("rect");
    expect(item.path).toBe("s/g/rect0");
    expect(item.matrix[4]).toBeCloseTo(55);
  });

  it("wraps a blurred group into a layer", () => {
    const c = comp(({ root }) => {
      root.add(group({ name: "g", blur: 8 })).add(rect({ width: 10, height: 10 }));
    });
    const [layer] = evaluateFrame(c, 0).items as LayerItem[];
    expect(layer).toMatchObject({ kind: "layer", path: "s/g", blur: 8, opacity: 1 });
    expect(layer.items.map((i) => i.path)).toEqual(["s/g/rect0"]);
  });

  it("keeps a translucent leaf as a plain item", () => {
    const c = comp(({ root }) => {
      root.add(rect({ width: 10, height: 10, opacity: 0.5 }));
    });
    expect(evaluateFrame(c, 0).items).toMatchObject([{ kind: "rect", opacity: 0.5 }]);
  });

  it("isolates a translucent parent and multiplies ancestor opacity into it", () => {
    const c = comp(({ root }) => {
      const outer = root.add(group({ name: "outer", opacity: 0.5 }));
      outer.add(group({ name: "inner", opacity: 0.5 })).add(rect({ width: 1, height: 1 }));
    });
    const [outer] = evaluateFrame(c, 0).items as LayerItem[];
    expect(outer).toMatchObject({ kind: "layer", path: "s/outer", opacity: 0.5 });
    expect(outer.items[0]).toMatchObject({ kind: "layer", path: "s/outer/inner", opacity: 0.5 });
  });

  it("includes the node's own drawable inside its layer, before its children", () => {
    const c = comp(({ root }) => {
      root.add(rect({ name: "win", width: 50, height: 50, clip: true, radius: 8 })).add(rect({ name: "content" }));
    });
    const [layer] = evaluateFrame(c, 0).items as LayerItem[];
    expect(layer.items.map((i) => i.path)).toEqual(["s/win", "s/win/content"]);
    expect(layer.clip).toMatchObject({ width: 50, height: 50, radius: 8 });
  });

  it("omits fully transparent nodes and their subtrees", () => {
    const c = comp(({ root }) => {
      root.add(group({ opacity: 0 })).add(rect());
      root.add(rect({ name: "seen" }));
    });
    expect(evaluateFrame(c, 0).items.map((i) => i.path)).toEqual(["s/seen"]);
  });

  it("orders siblings by z, stable for ties", () => {
    const c = comp(({ root }) => {
      root.add(rect({ name: "a", z: 1 }));
      root.add(rect({ name: "b" }));
      root.add(rect({ name: "c" }));
    });
    expect(evaluateFrame(c, 0).items.map((i) => i.path)).toEqual(["s/b", "s/c", "s/a"]);
  });

  it("lists image assets of the frame", () => {
    const c = comp(({ root }) => {
      root.add(image({ src: "assets/a.png", width: 10, height: 10 }));
    });
    expect(evaluateFrame(c, 0).assets).toEqual(["assets/a.png"]);
  });

  it("uses scene background over composition background", () => {
    const c = comp(() => {}, { duration: 1, background: "#112233" });
    expect(evaluateFrame(c, 0).background).toBe("#112233");
  });

  it("is deterministic regardless of evaluation history", () => {
    const make = () =>
      comp(({ root, random }) => {
        root.add(rect({ width: 10, height: 10, x: random() * 100 })).to({ y: 90, rotation: 45 }, { at: 0.2, duration: 1.5 });
      });
    const direct = evaluateFrame(make(), 45);
    const c = make();
    for (let f = 0; f < 45; f++) evaluateFrame(c, f);
    expect(evaluateFrame(c, 45)).toEqual(direct);
  });

  it("renders the background of an empty composition", () => {
    const c = composition({ width: 10, height: 10, fps: 30, scenes: [] });
    expect(evaluateFrame(c, 5)).toEqual({ width: 10, height: 10, background: "#000000", items: [], assets: [] });
  });
});

describe("collectAssets", () => {
  it("collects image srcs from every scene, sorted and unique", () => {
    const c = composition({
      width: 10,
      height: 10,
      fps: 30,
      scenes: [
        scene("a", { duration: 1 }, ({ root }) => {
          root.add(image({ src: "assets/b.png" }));
        }),
        scene("b", { duration: 1 }, ({ root }) => {
          root.add(group()).add(image({ src: "assets/a.png" }));
          root.add(image({ src: "assets/b.png" }));
        }),
      ],
    });
    expect(collectAssets(c)).toEqual(["assets/a.png", "assets/b.png"]);
  });
});
