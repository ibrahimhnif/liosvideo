import { describe, expect, it } from "vitest";
import { group, image, rect, text } from "../src/graph/kinds";
import { apply } from "../src/math/affine";

describe("Node props", () => {
  it("has spec defaults", () => {
    const p = rect().propsAt(0);
    expect(p).toMatchObject({
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0,
      opacity: 1, z: 0, blur: 0, width: 0, height: 0, radius: 0, clip: false,
    });
  });

  it("has text defaults", () => {
    expect(text({ text: "hi" }).propsAt(0)).toMatchObject({
      text: "hi", fontFamily: "SF Pro Text", fontSize: 48, fontWeight: 400, color: "#ffffff", lineHeight: 1.2,
    });
  });

  it("animates with to()", () => {
    const r = rect().to({ x: 100 }, { at: 1, duration: 1 });
    expect(r.propsAt(1.5).x).toBe(50);
  });

  it("sets instantly with set()", () => {
    const r = rect().set({ opacity: 0 }, 2);
    expect(r.propsAt(1.99).opacity).toBe(1);
    expect(r.propsAt(2).opacity).toBe(0);
  });

  it("chains to() from the previous animated value", () => {
    const r = rect().to({ x: 100 }, { at: 0, duration: 1 }).to({ x: 0 }, { at: 2, duration: 1 });
    expect(r.propsAt(2.5).x).toBe(50);
  });

  it("keeps image src", () => {
    expect(image({ src: "assets/a.png" }).propsAt(0)).toMatchObject({ src: "assets/a.png", fit: "fill" });
  });
});

describe("Node matrix", () => {
  it("rotates about the anchor and translates to x,y", () => {
    const r = rect({ x: 10, y: 20, rotation: 90, width: 100, height: 50, anchorX: 0.5, anchorY: 0.5 });
    const [x, y] = apply(r.localMatrix(0), 50, 25);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(20);
  });

  it("rotates clockwise in screen space", () => {
    const r = rect({ rotation: 90 });
    const [x, y] = apply(r.localMatrix(0), 1, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });
});

describe("Node paths", () => {
  it("builds stable paths with default and duplicate names", () => {
    const d = group({ name: "desktop" });
    const a = d.add(rect());
    const b = d.add(rect());
    const t1 = d.add(text({ name: "title" }));
    const t2 = d.add(text({ name: "title" }));
    expect([a, b, t1, t2].map((n) => n.path())).toEqual([
      "desktop/rect0", "desktop/rect1", "desktop/title", "desktop/title~2",
    ]);
  });

  it("nests paths", () => {
    const d = group({ name: "desktop" });
    const w = d.add(group({ name: "chrome" }));
    expect(w.add(text({ name: "urlbar" })).path()).toBe("desktop/chrome/urlbar");
    expect(w.parent).toBe(d);
    expect(d.children).toEqual([w]);
  });
});
