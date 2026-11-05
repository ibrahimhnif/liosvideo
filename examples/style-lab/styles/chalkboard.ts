/**
 * Chalkboard — chalk lines and handwriting written onto a green board.
 *
 * Build the scene as `board()` (background) plus a `chalkLayer()` that holds every
 * stroke and word: the layer's chalk filter gives them the dusty, broken edge.
 * Write things on over time — `chalkLine` / `chalkCircle` draw, `chalkWrite` reveals text
 * left to right — never just fade them in.
 */
import { circle, group, rect, text, type BaseProps, type Ease, type GroupNode, type NodeInit } from "liosvideo";

export const theme = {
  colors: {
    board: "#1f3d2b",
    boardDark: "#16301f",
    frame: "#6b4a2b",
    chalk: "#f2f2ea",
    yellow: "#f6e27a",
    pink: "#f4a6b8",
    blue: "#9fd3f0",
  },
  fonts: { hand: "Chalkduster", plain: "Chalkboard SE" },
  ease: { write: "linear" as Ease, settle: "outCubic" as Ease },
};

/** Props for the group that holds the chalk marks. */
export const look: Partial<BaseProps> = { chalk: 0.55 };

type Point = [number, number];
type StrokeOptions = { width: number; color?: string; at?: number; duration?: number; name?: string };

/** The green board with a few eraser smudges and a wooden ledge. */
export function board(width: number, height: number): GroupNode {
  const u = Math.min(width, height) / 100;
  const g = group({ name: "board", width, height });
  g.add(rect({ name: "slate", width, height, fill: theme.colors.board }));
  const smudge = g.add(group({ name: "smudges", blur: u * 6, opacity: 0.035 }));
  [[0.2, 0.25, 22], [0.7, 0.4, 30], [0.4, 0.75, 26]].forEach(([fx, fy, r], i) => {
    smudge.add(circle({ name: `smudge${i}`, radius: r * u, x: width * fx, y: height * fy, anchorX: 0.5, anchorY: 0.5, fill: theme.colors.chalk }));
  });
  g.add(rect({ name: "ledge", y: height - u * 3, width, height: u * 3, fill: theme.colors.frame }));
  return g;
}

/** A full-frame group with the chalk look; add strokes and words to it. */
export function chalkLayer(width: number, height: number, init: NodeInit<BaseProps> = {}): GroupNode {
  return group({ name: "chalk", width, height, ...look, ...init });
}

/** A polyline drawn on from the first point to the last over `duration` seconds. */
export function chalkLine(points: Point[], o: StrokeOptions): GroupNode {
  const g = group({ name: o.name ?? "line" });
  const segs = points.slice(1).map((p, i) => [points[i], p] as const);
  const total = segs.reduce((n, [a, b]) => n + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) || 1;
  let done = 0;
  segs.forEach(([a, b], i) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const w = len + o.width;
    const seg = g.add(
      rect({
        name: `s${i}`, x: a[0], y: a[1], width: w, height: o.width, radius: o.width / 2,
        anchorX: o.width / 2 / w, anchorY: 0.5, rotation: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
        fill: o.color ?? theme.colors.chalk,
      }),
    );
    if (o.duration) {
      seg.set({ scaleX: 0 }, 0);
      seg.to({ scaleX: 1 }, { at: (o.at ?? 0) + (o.duration * done) / total, duration: Math.max((o.duration * len) / total, 1 / 60), ease: "linear" });
    }
    done += len;
  });
  return g;
}

/** A hand-drawn circle (slightly open, slightly wobbly) drawn on. */
export function chalkCircle(cx: number, cy: number, r: number, o: StrokeOptions & { wobble?: number }): GroupNode {
  const wobble = o.wobble ?? 0.015;
  const points: Point[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = -Math.PI / 2 + (i / 72) * Math.PI * 2.06;
    const k = 1 + wobble * Math.sin(i * 0.45);
    points.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return chalkLine(points, { name: "circle", ...o });
}

/** An arrow from `from` to `to`, head drawn last. */
export function chalkArrow(from: Point, to: Point, o: StrokeOptions): GroupNode {
  const g = group({ name: o.name ?? "arrow" });
  const at = o.at ?? 0;
  const duration = o.duration ?? 0.6;
  g.add(chalkLine([from, to], { ...o, name: "shaft", at, duration: duration * 0.7 }));
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const head = o.width * 5;
  for (const side of [-1, 1]) {
    const a = ang + Math.PI - side * 0.5;
    g.add(chalkLine([to, [to[0] + Math.cos(a) * head, to[1] + Math.sin(a) * head]], { ...o, name: `head${side}`, at: at + duration * 0.7, duration: duration * 0.3 }));
  }
  return g;
}

/** Text written on left to right in chalk handwriting. `width` is the clip width to reveal. */
export function chalkWrite(
  label: string,
  o: { size: number; x: number; y: number; at?: number; duration?: number; color?: string; font?: string; name?: string },
): GroupNode {
  const estimate = label.length * o.size * 0.8;
  const reveal = group({ name: o.name ?? "words", x: o.x, y: o.y, width: 0, height: o.size * 1.6, clip: true });
  reveal.add(text({ name: "text", text: label, fontFamily: o.font ?? theme.fonts.hand, fontSize: o.size, color: o.color ?? theme.colors.chalk }));
  reveal.to({ width: estimate }, { at: o.at ?? 0, duration: o.duration ?? label.length * 0.06, ease: "linear" });
  return reveal;
}
