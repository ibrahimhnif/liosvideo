import { afterEach, describe, expect, it } from "vitest";
import { group, rect, setTextMeasurer, text } from "../src/graph/kinds";
import { layout, stack } from "../src/layout";

describe("layout grid", () => {
  it("derives the rhythm unit and a 16:9 safe area", () => {
    const L = layout({ width: 1920, height: 1080 });
    expect(L.orientation).toBe("landscape");
    expect(L.u).toBeCloseTo(10.8);
    expect(L.safe.x).toBeCloseTo(64.8);
    expect(L.safe.y).toBeCloseTo(64.8);
    expect(L.safe.width).toBeCloseTo(1920 - 129.6);
    expect(L.safe.height).toBeCloseTo(1080 - 129.6);
    expect(L.columns).toBe(12);
  });

  it("keeps the 9:16 platform UI zones clear", () => {
    const L = layout({ width: 1080, height: 1920 });
    expect(L.orientation).toBe("portrait");
    expect(L.columns).toBe(4);
    expect(L.safe.y).toBeCloseTo(1920 * 0.05);
    expect(L.safe.y + L.safe.height).toBeCloseTo(1920 * 0.88);
  });

  it("spans columns edge to edge with gutters between them", () => {
    const L = layout({ width: 1920, height: 1080 });
    const all = L.col(1, 12);
    expect(all.x).toBeCloseTo(L.safe.x);
    expect(all.width).toBeCloseTo(L.safe.width);
    const a = L.col(1, 6);
    const b = L.col(7, 6);
    expect(b.x - (a.x + a.width)).toBeCloseTo(L.gutter);
    expect(a.width).toBeCloseTo(b.width);
  });

  it("rejects columns outside the grid with a readable error", () => {
    const L = layout({ width: 1080, height: 1920 });
    expect(() => L.col(3, 4)).toThrow(/columns 3–6 do not fit the 4-column portrait grid/);
    expect(() => L.col(0)).toThrow();
  });

  it("builds cells from columns and rows", () => {
    const L = layout({ width: 1920, height: 1080 });
    const c = L.cell(1, 6, 1, 3);
    expect(c.x).toBeCloseTo(L.col(1, 6).x);
    expect(c.width).toBeCloseTo(L.col(1, 6).width);
    expect(c.y).toBeCloseTo(L.row(1, 3).y);
    expect(c.height).toBeCloseTo(L.row(1, 3).height);
  });

  it("only allows the spacing scale", () => {
    const L = layout({ width: 1920, height: 1080 });
    expect(L.gap(3)).toBeCloseTo(32.4);
    expect(() => L.gap(5 as 4)).toThrow(/1, 2, 3, 4, 6, 8/);
  });

  it("stacks left/right slots in landscape and top/bottom in portrait", () => {
    const wide = layout({ width: 1920, height: 1080 });
    expect(wide.slot("left").y).toBeCloseTo(wide.slot("right").y);
    expect(wide.slot("left").x).toBeLessThan(wide.slot("right").x);
    const tall = layout({ width: 1080, height: 1920 });
    expect(tall.slot("left").x).toBeCloseTo(tall.slot("right").x);
    expect(tall.slot("left").y).toBeLessThan(tall.slot("right").y);
  });

  it("keeps every slot inside the safe area", () => {
    for (const size of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }]) {
      const L = layout(size);
      for (const name of L.slotNames) {
        const s = L.slot(name);
        expect(s.x).toBeGreaterThanOrEqual(L.safe.x - 1e-6);
        expect(s.y).toBeGreaterThanOrEqual(L.safe.y - 1e-6);
        expect(s.x + s.width).toBeLessThanOrEqual(L.safe.x + L.safe.width + 1e-6);
        expect(s.y + s.height).toBeLessThanOrEqual(L.safe.y + L.safe.height + 1e-6);
      }
    }
  });

  it("scales type with the rhythm unit and keeps headline/body line heights", () => {
    const L = layout({ width: 1920, height: 1080 });
    expect(L.type.h1.fontSize).toBeGreaterThan(L.type.body.fontSize);
    expect(L.type.display.fontSize).toBeGreaterThan(L.type.h1.fontSize);
    expect(L.type.h1.lineHeight).toBeGreaterThanOrEqual(1.1);
    expect(L.type.h1.lineHeight).toBeLessThanOrEqual(1.2);
    expect(L.type.body.lineHeight).toBeGreaterThanOrEqual(1.4);
    expect(L.type.body.lineHeight).toBeLessThanOrEqual(1.5);
    expect(layout({ width: 3840, height: 2160 }).type.body.fontSize).toBeCloseTo(L.type.body.fontSize * 2, 0);
  });
});

describe("stack", () => {
  afterEach(() => setTextMeasurer(undefined));
  const mono = (p: { text: string; fontSize: number }) => {
    const lines = p.text.split("\n");
    return { width: Math.max(...lines.map((l) => l.length * 10)), height: lines.length * p.fontSize };
  };

  it("places children top to bottom with the gap, inside the box", () => {
    const box = { x: 100, y: 50, width: 400, height: 300 };
    const a = rect({ name: "a", width: 400, height: 40 });
    const b = rect({ name: "b", width: 400, height: 60 });
    const g = stack(box, [a, b], { gap: 20 });
    expect(g.propsAt(0)).toMatchObject({ x: 100, y: 50, width: 400, height: 300 });
    expect(g.children).toEqual([a, b]);
    expect(a.propsAt(0)).toMatchObject({ x: 0, y: 0 });
    expect(b.propsAt(0)).toMatchObject({ x: 0, y: 60 });
  });

  it("wraps text children to the box width and aligns them", () => {
    setTextMeasurer(mono);
    const t = text({ name: "t", text: "aaa bbb ccc", fontSize: 10 });
    stack({ x: 0, y: 0, width: 70, height: 100 }, [t], { gap: 0, align: "center" });
    expect(t.propsAt(0)).toMatchObject({ text: "aaa bbb\nccc", align: "center", maxWidth: 70, width: 70 });
  });

  it("aligns fixed-size children on the cross axis", () => {
    const r = rect({ width: 100, height: 10 });
    stack({ x: 0, y: 0, width: 400, height: 100 }, [r], { gap: 0, align: "right" });
    expect(r.propsAt(0).x).toBe(300);
  });

  it("justifies the whole column vertically", () => {
    const r = rect({ width: 10, height: 40 });
    stack({ x: 0, y: 0, width: 100, height: 100 }, [r], { gap: 0, justify: "center" });
    expect(r.propsAt(0).y).toBe(30);
    const s = rect({ width: 10, height: 40 });
    stack({ x: 0, y: 0, width: 100, height: 100 }, [s], { gap: 0, justify: "end" });
    expect(s.propsAt(0).y).toBe(60);
  });

  it("lays out a row left to right, centred on the cross axis", () => {
    const a = rect({ width: 50, height: 20 });
    const b = rect({ width: 30, height: 40 });
    stack({ x: 0, y: 0, width: 200, height: 40 }, [a, b], { gap: 10, direction: "row", align: "center" });
    expect(a.propsAt(0)).toMatchObject({ x: 0, y: 10 });
    expect(b.propsAt(0)).toMatchObject({ x: 60, y: 0 });
  });

  it("keeps a child's explicit anchor out of the math", () => {
    const r = rect({ width: 100, height: 20, anchorX: 0.5, anchorY: 0.5 });
    stack({ x: 0, y: 0, width: 300, height: 100 }, [r], { gap: 0 });
    expect(r.propsAt(0)).toMatchObject({ x: 50, y: 10 });
  });

  it("takes the slot's own alignment when none is given", () => {
    setTextMeasurer(mono);
    const L = layout({ width: 1920, height: 1080 });
    const t = text({ text: "hi", fontSize: 10 });
    stack(L.slot("caption"), [t], { gap: L.gap(2) });
    expect(t.propsAt(0).align).toBe(L.slot("caption").align);
  });

  it("can be added under another group", () => {
    const root = group();
    const g = root.add(stack({ x: 0, y: 0, width: 10, height: 10 }, [], { gap: 0, name: "list" }));
    expect(g.path()).toBe("group0/list");
  });
});
