/**
 * Typography FX: typewriter, highlighter, kinetic word sync, count-up,
 * lower thirds and tickers.
 *
 * Character advances are estimated from the monospace ratio so the cursor and
 * clip masks line up with the rendered glyphs in both the desktop preview and
 * the headless CLI.
 */

import { group, rect, text, type GroupNode, type RectNode, type TextNode } from "liosvideo";
import { fonts, palette } from "./theme";
import type { FxNode } from "./motion";

export interface TypewriterOptions {
  text: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  /** Override the per-character advance (defaults to `fontSize * 0.6`). */
  charWidth?: number;
  at?: number;
  duration?: number;
  cursor?: boolean;
  cursorColor?: string;
  name?: string;
}

export interface TypewriterHandle {
  group: GroupNode;
  cursor?: RectNode;
  /** The text node that is being revealed (use it to auto-fit a highlighter). */
  text: TextNode;
  /** Measured width of the finished line, in px. */
  width: number;
}

export function typewriter(
  parent: GroupNode,
  opts: TypewriterOptions,
): TypewriterHandle {
  const size = opts.fontSize ?? 20;
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 1.2;
  const charWidth = opts.charWidth ?? size * 0.6;
  const color = opts.color ?? palette.text;

  const box = parent.add(
    group({
      name: opts.name ?? "typewriter",
      x: opts.x,
      y: opts.y,
      width: 0,
      height: size * 1.6,
      clip: true,
    }),
  );
  const line = box.add(
    text({
      name: "line",
      text: opts.text,
      x: 0,
      y: 2,
      fontFamily: opts.fontFamily ?? fonts.mono,
      fontSize: size,
      fontWeight: 600,
      color,
    }),
  );
  // The host installs a text measurer; propsAt(0) then returns the real width
  // for any font. Fall back to the monospace estimate in non-host environments.
  const measured = line.propsAt(0).width;
  const width = Math.max(1, measured > 0 ? measured : opts.text.length * charWidth);
  box.to({ width }, { at, duration, ease: "linear" });

  let cursor: RectNode | undefined;
  if (opts.cursor !== false) {
    cursor = parent.add(
      rect({
        name: "cursor",
        x: opts.x,
        y: opts.y + 2,
        width: Math.max(2, size * 0.09),
        height: size * 1.15,
        fill: opts.cursorColor ?? color,
        opacity: 1,
      }),
    );
    cursor.to({ x: opts.x + width }, { at, duration, ease: "linear" });
    const end = at + duration;
    for (let i = 0; i < 4; i++) {
      cursor.set({ opacity: 0 }, end + i * 0.32);
      cursor.set({ opacity: 1 }, end + i * 0.32 + 0.16);
    }
  }

  return { group: box, cursor, width, text: line };
}

export interface HighlighterOptions {
  /** Text node to fit automatically (position, width and height). */
  textNode?: TextNode;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Extra horizontal bleed when fitting a text node (default 6). */
  padding?: number;
  at?: number;
  duration?: number;
  color?: string;
  opacity?: number;
  rotation?: number;
  /** Draw order inside the parent. Use -1 to sit behind text added later. */
  z?: number;
  name?: string;
}

/**
 * Stabilo sweep behind a line of text.
 *
 * With `textNode`, the bar is measured to the real glyph box, so changing the
 * font family/size never breaks the highlight. Requires the text node to exist
 * first; pass `z: -1` to draw it behind text created afterwards.
 */
export function highlighter(parent: GroupNode, opts: HighlighterOptions): RectNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.4;
  const textNode = opts.textNode;
  const p = textNode?.propsAt(0);
  const host = textNode?.parent ?? parent;
  const fontSize = p?.fontSize ?? 20;
  const pad = opts.padding ?? 8;
  const x = opts.x ?? (p ? p.x : 0);
  const y = opts.y ?? (p ? p.y + fontSize * 0.02 : 0);
  const width = opts.width ?? (p && p.width > 0 ? p.width + pad : 120);
  const height = opts.height ?? fontSize * 1.32;

  const bar = host.add(
    rect({
      name: opts.name ?? "highlighter",
      x,
      y,
      width,
      height,
      radius: 3,
      fill: opts.color ?? palette.amber,
      opacity: opts.opacity ?? 0.34,
      rotation: opts.rotation ?? -1.2,
      anchorX: 0,
      z: opts.z ?? 0,
    }),
  );

  // When fitting a text node, sit directly behind it in the same parent. This
  // also keeps the bar inside a typewriter clip, so it is revealed with the text.
  if (textNode?.parent) {
    const siblings = textNode.parent.children;
    const barIndex = siblings.indexOf(bar);
    const textIndex = siblings.indexOf(textNode);
    if (barIndex > textIndex && textIndex >= 0) {
      siblings.splice(barIndex, 1);
      siblings.splice(textIndex, 0, bar);
    }
  }

  bar.set({ scaleX: 0 }, 0);
  bar.to({ scaleX: 1 }, { at, duration, ease: "outCubic" });
  return bar;
}

/** Real measured size of a text node (falls back to 0 outside a host). */
export function measureText(node: TextNode): { width: number; height: number } {
  const p = node.propsAt(0);
  return { width: p.width, height: p.height };
}

/** One word that pops and changes colour on its beat. */
export function kineticWord(
  parent: GroupNode,
  opts: {
    word: string;
    x: number;
    y: number;
    at?: number;
    size?: number;
    color?: string;
    accent?: string;
    family?: string;
    name?: string;
  },
): TextNode {
  const at = opts.at ?? 0;
  const baseColor = opts.color ?? palette.text;
  const accent = opts.accent ?? palette.amber;
  const node = parent.add(
    text({
      name: opts.name ?? `word-${opts.word.toLowerCase()}`,
      text: opts.word,
      x: opts.x,
      y: opts.y,
      anchorX: 0.5,
      anchorY: 0.5,
      fontSize: opts.size ?? 22,
      fontFamily: opts.family ?? fonts.display,
      fontWeight: 400,
      color: baseColor,
    }),
  );
  node.to({ color: accent, scaleX: 1.14, scaleY: 1.14 }, { at, duration: 0.12, ease: "outCubic" });
  node.to(
    { color: baseColor, scaleX: 1, scaleY: 1 },
    { at: at + 0.28, duration: 0.18, ease: "outCubic" },
  );
  return node;
}

/** Number roll driven by text keyframes (the renderer snaps strings). */
export function countUp(
  parent: GroupNode,
  opts: {
    from: number;
    to: number;
    x: number;
    y: number;
    at?: number;
    duration?: number;
    size?: number;
    color?: string;
    family?: string;
    weight?: number;
    prefix?: string;
    suffix?: string;
    steps?: number;
    name?: string;
  },
): TextNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 1.1;
  const steps = opts.steps ?? 26;
  const prefix = opts.prefix ?? "";
  const suffix = opts.suffix ?? "";
  const fmt = (v: number) => `${prefix}${Math.round(v)}${suffix}`;

  const node = parent.add(
    text({
      name: opts.name ?? "count-up",
      text: fmt(opts.from),
      x: opts.x,
      y: opts.y,
      fontSize: opts.size ?? 44,
      fontFamily: opts.family ?? fonts.mono,
      fontWeight: opts.weight ?? 700,
      color: opts.color ?? palette.text,
    }),
  );

  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const eased = 1 - (1 - p) ** 3;
    node.set({ text: fmt(opts.from + (opts.to - opts.from) * eased) }, at + duration * p);
  }
  return node;
}

/** Broadcast lower third that slides in from the left. */
export function lowerThird(
  parent: GroupNode,
  opts: {
    name: string;
    role: string;
    x: number;
    y: number;
    width?: number;
    at?: number;
    accent?: string;
    duration?: number;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.42;
  const width = opts.width ?? 320;
  const accent = opts.accent ?? palette.cyan;

  const box = parent.add(
    group({ name: "lower-third", x: opts.x, y: opts.y, width, height: 56, opacity: 0 }),
  );
  box.add(rect({ name: "bg", width, height: 56, radius: 8, fill: palette.panelDeep, opacity: 0.94 }));
  const bar = box.add(rect({ name: "accent", x: 0, y: 0, width: 4, height: 0, radius: 2, fill: accent }));
  box.add(
    text({
      name: "name",
      text: opts.name,
      x: 16,
      y: 9,
      fontSize: 18,
      fontWeight: 700,
      fontFamily: fonts.sans,
      color: palette.text,
    }),
  );
  box.add(
    text({
      name: "role",
      text: opts.role,
      x: 16,
      y: 33,
      fontSize: 11,
      fontFamily: fonts.mono,
      color: accent,
    }),
  );

  box.set({ x: opts.x - 46 }, 0);
  box.to({ x: opts.x, opacity: 1 }, { at, duration, ease: "outCubic" });
  bar.to({ height: 56 }, { at: at + 0.05, duration: duration, ease: "outCubic" });
  return box;
}

/** Scrolling ticker strip. */
export function ticker(
  parent: GroupNode,
  opts: {
    text: string;
    x: number;
    y: number;
    width: number;
    at?: number;
    speed?: number;
    fontSize?: number;
    color?: string;
    bg?: string;
    height?: number;
    name?: string;
    /** Initial x of the scrolling line (defaults to the strip width). */
    startX?: number;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const speed = opts.speed ?? 70;
  const height = opts.height ?? 24;
  const size = opts.fontSize ?? 12;
  const estimate = opts.text.length * size * 0.62;

  const box = parent.add(
    group({ name: opts.name ?? "ticker", x: opts.x, y: opts.y, width: opts.width, height }),
  );
  box.add(rect({ name: "bg", width: opts.width, height, fill: opts.bg ?? palette.panelDeep }));
  const line = box.add(
    text({
      name: "scroll",
      text: opts.text,
      x: opts.startX ?? opts.width,
      y: (height - size) / 2,
      fontSize: size,
      fontFamily: fonts.mono,
      color: opts.color ?? palette.muted,
    }),
  );
  const startX = opts.startX ?? opts.width;
  const measured = line.propsAt(0).width;
  const approx = measured > 0 ? measured : estimate;
  line.to(
    { x: -approx },
    { at, duration: (startX + approx) / speed, ease: "linear" },
  );
  return box;
}

/** Typewriter-style stamp: slams in, then settles. */
export function stampText(
  node: FxNode,
  opts: { at?: number; duration?: number; from?: number; rotation?: number } = {},
): FxNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.2;
  const from = opts.from ?? 1.7;
  const rotation = opts.rotation ?? -7;
  node.set({ opacity: 0, scaleX: from, scaleY: from, rotation }, 0);
  node.to(
    { opacity: 1, scaleX: 1, scaleY: 1, rotation: 0 },
    { at, duration, ease: "inCubic" },
  );
  return node;
}
