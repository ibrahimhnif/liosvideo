import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerVoTiming } from "../src/audio/timing";
import { captions } from "../src/components/captions";
import { group, setTextMeasurer, TextNode, type TextProps } from "../src/graph/kinds";
import type { Node } from "../src/graph/node";
import { layout } from "../src/layout";

// letters 0.6 em, spaces 0.25 em (like a real sans): long words really are long
const lineWidth = (l: string, size: number) => [...l].reduce((w, c) => w + (c === " " ? 0.25 : 0.6), 0) * size;
const measure = (p: TextProps) => {
  const lines = p.text.split("\n");
  return {
    width: Math.max(...lines.map((l) => lineWidth(l, p.fontSize))),
    height: lines.length * p.fontSize * p.lineHeight,
  };
};

const SENTENCE =
  "Ketidakbertanggungjawaban para pejabat, menurut laporan itu, memperlihatkan pertanggungjawabannya yang lemah. Apakah ini akan berubah?";

function timing(id: string, text: string, step = 0.4) {
  const words = text.split(" ").map((word, i) => ({ word, start: i * step, end: i * step + step * 0.8 }));
  registerVoTiming({ lineId: id, duration: words.length * step, words });
}

/** absolute box of a node at time t, summing parent offsets (anchors are 0 for caption nodes' parents) */
function box(node: Node<any>, t: number) {
  const p = node.propsAt(t);
  let x = p.x - p.anchorX * p.width;
  let y = p.y - p.anchorY * p.height;
  for (let n = node.parent; n; n = n.parent) {
    const q = n.propsAt(t);
    x += q.x - q.anchorX * q.width;
    y += q.y - q.anchorY * q.height;
  }
  return { x, y, width: p.width, height: p.height };
}

function words(root: Node<any>): TextNode[] {
  const out: TextNode[] = [];
  const walk = (n: Node<any>) => {
    if (n instanceof TextNode) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

function visibleAt(node: Node<any>, t: number): boolean {
  for (let n: Node<any> | undefined = node; n; n = n.parent) if (n.propsAt(t).opacity <= 0.001) return false;
  return true;
}

describe("captions", () => {
  beforeEach(() => {
    setTextMeasurer(measure);
    timing("cap-h1", SENTENCE);
  });
  afterEach(() => setTextMeasurer(undefined));

  for (const [w, h] of [
    [1920, 1080],
    [1080, 1920],
  ]) {
    it(`keeps every word inside the safe area at ${w}x${h}, even long Indonesian words`, () => {
      const root = group({ name: "s", width: w, height: h });
      captions(root, { lines: ["cap-h1"] });
      const L = layout({ width: w, height: h });
      const nodes = words(root);
      expect(nodes.length).toBe(SENTENCE.split(" ").length);
      for (const n of nodes) {
        const b = box(n, 0);
        expect(b.x).toBeGreaterThanOrEqual(L.safe.x - 0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(L.safe.x + L.safe.width + 0.5);
        expect(b.y).toBeGreaterThanOrEqual(L.safe.y - 0.5);
        expect(b.y + b.height).toBeLessThanOrEqual(L.safe.y + L.safe.height + 0.5);
      }
    });
  }

  it("shows at most two lines at a time and one chunk at a time", () => {
    const root = group({ name: "s", width: 1080, height: 1920 });
    const layer = captions(root, { lines: ["cap-h1"] });
    for (const chunk of layer.children) {
      const ys = new Set(words(chunk).map((n) => Math.round(box(n, 0).y)));
      expect(ys.size).toBeLessThanOrEqual(2);
    }
    for (let t = 0; t < 7; t += 0.05) {
      expect(layer.children.filter((c) => visibleAt(c, t)).length).toBeLessThanOrEqual(1);
    }
  });

  it("ends a chunk at sentence punctuation", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    const layer = captions(root, { lines: ["cap-h1"] });
    const texts = layer.children.map((c) => words(c).map((n) => n.propsAt(0).text));
    const end = texts.findIndex((ws) => ws.some((x) => x.startsWith("lemah")));
    expect(texts[end].at(-1)).toMatch(/^lemah/);
    expect(texts[end + 1][0]).toBe("Apakah");
  });

  it("highlights each word while it is spoken", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    captions(root, { lines: ["cap-h1"], activeColor: "#ffd60a", color: "#ffffff" });
    const nodes = words(root);
    const third = nodes[2]; // spoken 0.8 .. 1.12
    expect(third.propsAt(0.5).color).toBe("#ffffff");
    expect(third.propsAt(0.95).color).toBe("#ffd60a");
    expect(third.propsAt(1.4).color).toBe("#ffffff");
    expect(visibleAt(third, 0.95)).toBe(true);
  });

  it("starts each line at its own time and hides after the last word", () => {
    timing("cap-h2", "Kedua kalimat pendek.");
    const root = group({ name: "s", width: 1920, height: 1080 });
    const layer = captions(root, { lines: ["cap-h1", { id: "cap-h2", at: 20 }] });
    const last = layer.children.at(-1)!;
    expect(visibleAt(last, 19.9)).toBe(false);
    expect(visibleAt(last, 20.1)).toBe(true);
    expect(visibleAt(last, 22)).toBe(false);
  });

  it("plays string ids back to back with a gap", () => {
    timing("cap-h2", "Kedua kalimat pendek.");
    const root = group({ name: "s", width: 1920, height: 1080 });
    const layer = captions(root, { lines: ["cap-h1", "cap-h2"], gap: 0.5 });
    const h1 = SENTENCE.split(" ").length * 0.4;
    const last = layer.children.at(-1)!;
    expect(visibleAt(last, h1 + 0.45)).toBe(false);
    expect(visibleAt(last, h1 + 0.55)).toBe(true);
  });

  it("never lets the growing active word touch its neighbours", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    const layer = captions(root, { lines: ["cap-h1"] });
    for (const chunk of layer.children) {
      const ws = words(chunk);
      ws.forEach((n, i) => {
        const p = n.propsAt(0);
        const t = 0.4 * SENTENCE.split(" ").indexOf(p.text) + 0.2; // mid-word, fully scaled up
        const grown = n.propsAt(t);
        const half = (p.width * grown.scaleX) / 2;
        const prev = ws[i - 1];
        const next = ws[i + 1];
        if (prev && box(prev, t).y === box(n, t).y) {
          const pp = prev.propsAt(t);
          expect(pp.x + (pp.width * pp.scaleX) / 2).toBeLessThan(p.x - half);
        }
        if (next && box(next, t).y === box(n, t).y) {
          const np = next.propsAt(t);
          expect(p.x + half).toBeLessThan(np.x - (np.width * np.scaleX) / 2);
        }
      });
    }
  });

  it("draws a background pill when asked", () => {
    const root = group({ name: "s", width: 1080, height: 1920 });
    const layer = captions(root, { lines: ["cap-h1"], background: "#000000aa" });
    expect(layer.children[0].children.some((c) => c.kind === "rect")).toBe(true);
  });

  it("throws a clear error for a line without timings", () => {
    const root = group({ name: "s", width: 1920, height: 1080 });
    expect(() => captions(root, { lines: ["missing-line"] })).toThrow(/timing for VO line "missing-line"/);
  });
});
