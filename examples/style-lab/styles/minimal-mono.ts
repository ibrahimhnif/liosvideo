/**
 * Minimal Mono — black and white serif statements, one idea per screen.
 *
 * Near-black background, off-white serif type, lots of empty space. Lines fade up one
 * after another (`fadeUp`, ~0.35 s apart). One key word gets a hand-drawn underline
 * (`handUnderline`) the moment it matters. No colour except one muted accent, no filters.
 */
import { group, rect, text, type BaseProps, type Ease, type GroupNode, type Node } from "liosvideo";

export const theme = {
  colors: {
    bg: "#0b0b0b",
    ink: "#f2efe8",
    muted: "#8a8780",
    accent: "#f2efe8",
  },
  fonts: { statement: "Georgia", caption: "Avenir Next" },
  ease: { rise: "outCubic" as Ease, draw: "inOutCubic" as Ease },
};

/** Minimal mono needs no filter. */
export const look: Partial<BaseProps> = {};

/** Measures a single line of text; falls back to an estimate where no measurer exists (tests). */
export function measure(label: string, size: number, fontFamily = theme.fonts.statement, fontWeight = 400): number {
  const w = text({ text: label, fontFamily, fontSize: size, fontWeight }).propsAt(0).width;
  return w > 0 ? w : label.length * size * 0.5;
}

/** Fades a node in while it rises `distance` px into place. */
export function fadeUp<N extends Node<any>>(node: N, at: number, distance = 24, duration = 0.6): N {
  const y = node.propsAt(0).y;
  node.set({ opacity: 0, y: y + distance }, 0);
  node.to({ opacity: 1, y }, { at, duration, ease: theme.ease.rise });
  return node;
}

/** A statement: one text node per line, left-aligned at (x, y), fading up line by line. */
export function statement(lines: string[], o: { x: number; y: number; size: number; at: number; stagger?: number; color?: string; name?: string }): GroupNode & { lines: Node<any>[] } {
  const g = group({ name: o.name ?? "statement", x: o.x, y: o.y }) as GroupNode & { lines: Node<any>[] };
  g.lines = lines.map((line, i) =>
    fadeUp(
      g.add(text({ name: `line${i}`, text: line, y: i * o.size * 1.3, fontFamily: theme.fonts.statement, fontSize: o.size, color: o.color ?? theme.colors.ink })),
      o.at + i * (o.stagger ?? 0.35),
      o.size * 0.35,
    ),
  );
  return g;
}

/**
 * A hand-drawn underline from (x, y), `width` long, drawn on left to right.
 * It is a few slightly tilted strokes, so it reads as a pen mark, not a rule.
 */
export function handUnderline(x: number, y: number, width: number, o: { at: number; duration?: number; thickness?: number; color?: string; name?: string }): GroupNode {
  const t = o.thickness ?? Math.max(3, width * 0.035);
  const g = group({ name: o.name ?? "underline", x, y });
  const pts: [number, number][] = [[0, t * 0.4], [width * 0.35, -t * 0.1], [width * 0.7, t * 0.25], [width * 1.04, -t * 0.5]];
  const duration = o.duration ?? 0.45;
  pts.slice(1).forEach((b, i) => {
    const a = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const w = len + t;
    const seg = g.add(
      rect({
        name: `s${i}`, x: a[0], y: a[1], width: w, height: t, radius: t / 2, anchorX: t / 2 / w, anchorY: 0.5,
        rotation: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, fill: o.color ?? theme.colors.accent,
      }),
    );
    seg.set({ scaleX: 0 }, 0);
    seg.to({ scaleX: 1 }, { at: o.at + (duration * i) / 3, duration: duration / 3, ease: "linear" });
  });
  return g;
}
