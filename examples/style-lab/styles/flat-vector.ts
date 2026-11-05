/**
 * Flat Vector — flat colour shapes, no gradients, no outlines, bouncy motion.
 *
 * Use a small palette (one dark, one light, three accents), rounded shapes and
 * generous whitespace. Everything enters with `pop()` (scale from 0, `outBack`),
 * staggered by ~0.08 s. Bars grow with `grow()`.
 */
import { circle, group, rect, text, type BaseProps, type Ease, type GroupNode, type Node, type NodeInit } from "liosvideo";

export const theme = {
  colors: {
    bg: "#f4efe6",
    navy: "#1f2a44",
    coral: "#ff6b5b",
    teal: "#2ec4b6",
    yellow: "#ffbf3c",
    lavender: "#8e7dff",
    white: "#ffffff",
  },
  fonts: { heading: "Avenir Next", body: "Avenir Next" },
  ease: { pop: "outBack" as Ease, glide: "outCubic" as Ease },
};

/** Flat vector needs no filter. */
export const look: Partial<BaseProps> = {};

/** Scales a node in from 0 with a little overshoot at `at`. */
export function pop<N extends Node<any>>(node: N, at: number, duration = 0.45): N {
  node.set({ scaleX: 0, scaleY: 0 }, 0);
  node.to({ scaleX: 1, scaleY: 1 }, { at, duration, ease: theme.ease.pop });
  return node;
}

/** Grows a bar upward from its base (anchorY 1) at `at`. */
export function grow<N extends Node<any>>(node: N, at: number, duration = 0.6): N {
  node.set({ scaleY: 0 }, 0);
  node.to({ scaleY: 1 }, { at, duration, ease: theme.ease.pop });
  return node;
}

/** A simple flat character: round head, rounded body, two arms. `size` is the body height. */
export function person(x: number, y: number, size: number, o: { shirt?: string; skin?: string; name?: string } = {}): GroupNode {
  const g = group({ name: o.name ?? "person", x, y });
  const shirt = o.shirt ?? theme.colors.teal;
  g.add(rect({ name: "body", width: size * 0.7, height: size, radius: size * 0.3, anchorX: 0.5, anchorY: 1, fill: shirt }));
  for (const side of [-1, 1]) {
    g.add(rect({ name: `arm${side}`, x: side * size * 0.3, y: -size * 0.75, width: size * 0.16, height: size * 0.55, radius: size * 0.08, anchorX: 0.5, rotation: side * -20, fill: shirt }));
  }
  g.add(circle({ name: "head", y: -size * 1.22, radius: size * 0.24, anchorX: 0.5, anchorY: 0.5, fill: o.skin ?? "#f2b38a" }));
  g.add(rect({ name: "hair", y: -size * 1.5, width: size * 0.44, height: size * 0.14, radius: size * 0.07, anchorX: 0.5, fill: theme.colors.navy }));
  for (const side of [-1, 1]) {
    g.add(circle({ name: `eye${side}`, x: side * size * 0.08, y: -size * 1.25, radius: size * 0.03, anchorX: 0.5, anchorY: 0.5, fill: theme.colors.navy }));
  }
  g.add(rect({ name: "smile", y: -size * 1.13, width: size * 0.12, height: size * 0.035, radius: size * 0.02, anchorX: 0.5, fill: theme.colors.navy }));
  return g;
}

/** A rounded card with a big number and a label. */
export function stat(value: string, label: string, o: { x: number; y: number; width: number; color?: string; name?: string }): GroupNode {
  const h = o.width * 0.62;
  const g = group({ name: o.name ?? "stat", x: o.x, y: o.y, width: o.width, height: h, anchorX: 0.5, anchorY: 0.5 });
  g.add(rect({ name: "card", width: o.width, height: h, radius: h * 0.18, fill: theme.colors.white }));
  g.add(rect({ name: "accent", width: o.width * 0.18, height: h * 0.08, x: o.width * 0.12, y: h * 0.16, radius: h * 0.04, fill: o.color ?? theme.colors.coral }));
  g.add(text({ name: "value", text: value, x: o.width * 0.12, y: h * 0.3, fontFamily: theme.fonts.heading, fontWeight: 800, fontSize: h * 0.34, color: theme.colors.navy }));
  g.add(text({ name: "label", text: label, x: o.width * 0.12, y: h * 0.7, fontFamily: theme.fonts.body, fontWeight: 500, fontSize: h * 0.13, color: "#6b7280" }));
  return g;
}

/** A flat coin icon. */
export function coin(x: number, y: number, r: number, init: NodeInit<BaseProps> = {}): GroupNode {
  const g = group({ name: "coin", x, y, ...init });
  g.add(circle({ name: "rim", radius: r, anchorX: 0.5, anchorY: 0.5, fill: "#e8a317" }));
  g.add(circle({ name: "face", radius: r * 0.78, anchorX: 0.5, anchorY: 0.5, fill: theme.colors.yellow }));
  g.add(text({ name: "sign", text: "$", fontFamily: theme.fonts.heading, fontWeight: 800, fontSize: r, anchorX: 0.5, anchorY: 0.5, color: "#e8a317" }));
  return g;
}
