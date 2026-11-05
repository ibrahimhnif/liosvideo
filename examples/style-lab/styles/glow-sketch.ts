/**
 * Glow Sketch — glowing line drawings that draw themselves on black.
 *
 * Draw with `neonLine` / `neonCircle` inside a `neonLayer()` (its glow filter makes the
 * bloom). `boil()` re-jitters a drawing a few times a second, like hand-drawn animation.
 * Keep to two or three neon colours and thin lines; let the glow do the work.
 */
import { circle, group, rect, text, type BaseProps, type Ease, type GroupNode, type Node, type NodeInit } from "liosvideo";

export const theme = {
  colors: {
    bg: "#05060a",
    cyan: "#3df5ff",
    magenta: "#ff3df0",
    lime: "#b6ff3d",
    amber: "#ffb43d",
    white: "#f4fbff",
  },
  fonts: { label: "Avenir Next", hand: "Bradley Hand" },
  ease: { draw: "inOutCubic" as Ease, flicker: "linear" as Ease },
};

/** Props for the group that holds the neon lines. */
export const look: Partial<BaseProps> = { glow: 24, glowIntensity: 2.6 };

type Point = [number, number];
type StrokeOptions = { width: number; color?: string; at?: number; duration?: number; name?: string };

/** A full-frame group with the glow look; add drawings to it. */
export function neonLayer(width: number, height: number, init: NodeInit<BaseProps> = {}): GroupNode {
  return group({ name: "neon", width, height, ...look, ...init });
}

/** A polyline drawn on from the first point to the last over `duration` seconds. */
export function neonLine(points: Point[], o: StrokeOptions): GroupNode {
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
        fill: o.color ?? theme.colors.cyan,
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

/** A circle outline drawn on. */
export function neonCircle(cx: number, cy: number, r: number, o: StrokeOptions): GroupNode {
  const points: Point[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = -Math.PI / 2 + (i / 64) * Math.PI * 2;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return neonLine(points, { name: "circle", ...o });
}

/** A small glowing dot (stars, sparks). */
export function spark(x: number, y: number, r: number, color: string, init: NodeInit<BaseProps> = {}): ReturnType<typeof circle> {
  return circle({ name: "spark", x, y, radius: r, anchorX: 0.5, anchorY: 0.5, fill: color, ...init });
}

/** Neon sign text: a thin outline colour over a bright core. */
export function neonText(label: string, size: number, color: string, init: NodeInit<BaseProps> = {}): GroupNode {
  const g = group({ name: "neon-text", ...init });
  const common = { text: label, fontFamily: theme.fonts.label, fontSize: size, fontWeight: 600, anchorX: 0.5, anchorY: 0.5 };
  g.add(text({ name: "color", ...common, color }));
  g.add(text({ name: "core", ...common, color: theme.colors.white, opacity: 0.3, scaleX: 0.985, scaleY: 0.985 }));
  return g;
}

/**
 * Jitters `node` by up to `amount` px `fps` times a second between `from` and `to`,
 * like a hand-drawn line boiling. `random` is the scene's seeded random().
 */
export function boil(node: Node<any>, random: () => number, amount: number, from: number, to: number, fps = 8): void {
  const base = node.propsAt(from);
  for (let t = from; t < to; t += 1 / fps) {
    node.set({ x: base.x + (random() - 0.5) * 2 * amount, y: base.y + (random() - 0.5) * 2 * amount }, t);
  }
}

/** Flickers opacity like a failing neon tube. */
export function flicker(node: Node<any>, random: () => number, from: number, to: number): void {
  for (let t = from; t < to; t += 1 / 15) node.set({ opacity: random() < 0.82 ? 1 : 0.35 }, t);
  node.set({ opacity: 1 }, to);
}
