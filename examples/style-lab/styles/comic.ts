/**
 * Comic Art — panels, ink outlines, halftone shading and action words.
 *
 * Lay the page out with `panel()`s; put each panel's art in `panel.art` (it carries the
 * ink outline + halftone + posterize look). Lettering — `speechBubble`, `caption`,
 * `actionWord` — goes on top of the art, outside the look, so it stays crisp.
 * Pop things in fast (`outBack`, 0.2–0.3 s) and shake on impacts.
 */
import { circle, group, rect, text, type BaseProps, type Ease, type GroupNode, type Node } from "liosvideo";

export const theme = {
  colors: {
    paper: "#fdf6e3",
    ink: "#111111",
    red: "#e63946",
    yellow: "#ffd23f",
    blue: "#3a86ff",
    sky: "#8ecae6",
    skin: "#f4c095",
    purple: "#6a4c93",
  },
  fonts: { letter: "Comic Sans MS", impact: "Impact" },
  ease: { pop: "outBack" as Ease, slam: "outCubic" as Ease },
};

/** Props for the group that holds a panel's art. */
export const look: Partial<BaseProps> = { outline: 3, outlineColor: "#111111", halftone: 7, posterize: 5 };

export type Panel = GroupNode & { art: GroupNode };

/** A bordered panel. Draw inside `panel.art` (clipped, with the comic look). */
export function panel(x: number, y: number, width: number, height: number, o: { border?: number; bg?: string; name?: string } = {}): Panel {
  const border = o.border ?? Math.max(4, Math.min(width, height) * 0.012);
  const g = group({ name: o.name ?? "panel", x, y, width, height }) as Panel;
  g.add(rect({ name: "border", width, height, fill: theme.colors.ink }));
  const inner = g.add(group({ name: "inner", x: border, y: border, width: width - border * 2, height: height - border * 2, clip: true }));
  inner.add(rect({ name: "bg", width: width - border * 2, height: height - border * 2, fill: o.bg ?? theme.colors.sky }));
  g.art = inner.add(group({ name: "art", width: width - border * 2, height: height - border * 2, ...look }));
  return g;
}

/** A white speech bubble with a tail pointing at (`tailX`, `tailY`) in the parent's space. */
export function speechBubble(label: string, o: { x: number; y: number; width: number; size: number; tailX: number; tailY: number; name?: string }): GroupNode {
  const lines = label.split("\n");
  const height = o.size * (lines.length * 1.25 + 1.2);
  const words = text({
    name: "words", text: label, anchorX: 0.5, anchorY: 0.5,
    fontFamily: theme.fonts.letter, fontWeight: 700, fontSize: o.size, lineHeight: 1.25, color: theme.colors.ink,
  });
  // grow to fit the measured text when a measurer is available (preview and export)
  const width = Math.max(o.width, words.propsAt(0).width + o.size * 2);
  words.set({ x: width / 2, y: height / 2 }, 0);
  const g = group({ name: o.name ?? "bubble", x: o.x, y: o.y, width, height, anchorX: 0.5, anchorY: 0.5 });
  const stroke = Math.max(2, o.size * 0.12);
  // tail: a wedge from the bubble's centre toward the speaker
  const dx = o.tailX - o.x;
  const dy = o.tailY - o.y;
  const len = Math.hypot(dx, dy);
  const tail = g.add(
    rect({
      name: "tail", x: width / 2, y: height / 2, width: len * 0.78, height: o.size * 0.9,
      anchorX: 0, anchorY: 0.5, rotation: (Math.atan2(dy, dx) * 180) / Math.PI, fill: "#ffffff", stroke: theme.colors.ink, strokeWidth: stroke,
    }),
  );
  tail.set({ scaleY: 0.5 }, 0);
  g.add(rect({ name: "body", width, height, radius: height / 2, fill: "#ffffff", stroke: theme.colors.ink, strokeWidth: stroke }));
  g.add(words);
  return g;
}

/** A yellow caption box, top-left of a panel. */
export function caption(label: string, o: { x: number; y: number; size: number; name?: string }): GroupNode {
  const g = group({ name: o.name ?? "caption", x: o.x, y: o.y });
  const box = g.add(rect({ name: "box", width: label.length * o.size * 0.8 + o.size, height: o.size * 1.8, fill: theme.colors.yellow, stroke: theme.colors.ink, strokeWidth: Math.max(2, o.size * 0.1) }));
  const words = g.add(text({ name: "words", text: label.toUpperCase(), x: o.size * 0.5, y: o.size * 0.35, fontFamily: theme.fonts.letter, fontWeight: 700, fontSize: o.size, color: theme.colors.ink }));
  // fit the box to the measured text when a measurer is available (preview and export)
  const measured = words.propsAt(0).width;
  if (measured > 0) box.set({ width: measured + o.size }, 0);
  return g;
}

/** A starburst behind a big outlined sound effect ("POW!", "KA-BOOM!"). */
export function actionWord(label: string, o: { x: number; y: number; size: number; color?: string; burst?: string; rotation?: number; name?: string }): GroupNode {
  const g = group({ name: o.name ?? "sfx", x: o.x, y: o.y, rotation: o.rotation ?? -8 });
  const r = o.size * 1.5;
  for (let i = 0; i < 12; i++) {
    const long = i % 2 === 0;
    g.add(rect({ name: `ray${i}`, width: r * (long ? 2.6 : 2.0), height: r * 0.38, anchorX: 0.5, anchorY: 0.5, rotation: i * 15, fill: o.burst ?? theme.colors.yellow, stroke: theme.colors.ink, strokeWidth: 4 }));
  }
  g.add(circle({ name: "core", radius: r * 0.82, anchorX: 0.5, anchorY: 0.5, fill: o.burst ?? theme.colors.yellow }));
  const common = { text: label, fontFamily: theme.fonts.impact, fontSize: o.size, anchorX: 0.5, anchorY: 0.5 };
  // a fat ink outline from offset copies, then the face
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1.6]]) {
    g.add(text({ name: "ink", ...common, x: dx * o.size * 0.06, y: dy * o.size * 0.06, color: theme.colors.ink }));
  }
  g.add(text({ name: "face", ...common, color: o.color ?? theme.colors.red }));
  return g;
}

/** Shakes a node on impact for `duration` seconds. */
export function shake(node: Node<any>, at: number, amount: number, duration = 0.3): void {
  const base = node.propsAt(at);
  const steps = Math.round(duration * 30);
  for (let i = 0; i < steps; i++) {
    const k = 1 - i / steps;
    node.set({ x: base.x + (i % 2 ? 1 : -1) * amount * k, y: base.y + (i % 3 - 1) * amount * k }, at + i / 30);
  }
  node.set({ x: base.x, y: base.y }, at + duration);
}

/** Speed lines radiating from the centre of a panel (draw them in the panel art). */
export function speedLines(width: number, height: number, count = 18, color = "#ffffff"): GroupNode {
  const g = group({ name: "speed-lines" });
  const len = Math.hypot(width, height);
  for (let i = 0; i < count; i++) {
    g.add(rect({ name: `l${i}`, x: width / 2, y: height / 2, width: len, height: len * 0.012 * (1 + (i % 3)), anchorX: 0, anchorY: 0.5, rotation: (i * 360) / count + 7, fill: color }));
  }
  return g;
}
