/**
 * Pixel Art — chunky pixels, a limited palette and stepped motion (16-bit game look).
 *
 * Put everything inside `pixelStage()`: its pixelate + posterize filters turn any
 * shapes and text into pixels. Move things with `stepped()` easing so motion snaps
 * like sprite animation instead of gliding.
 */
import { group, rect, text, type Ease, type GroupNode, type NodeInit, type BaseProps } from "liosvideo";

export const theme = {
  colors: {
    night: "#1d2b53",
    sky: "#29adff",
    grass: "#00e436",
    dirt: "#ab5236",
    ink: "#000000",
    paper: "#fff1e8",
    gold: "#ffec27",
    red: "#ff004d",
    orange: "#ffa300",
    plum: "#7e2553",
  },
  fonts: { pixel: "Menlo" },
  ease: { snap: stepped(6) as Ease, pop: "outBack" as Ease },
};

/** Props for the group that holds the whole pixel scene. */
export const look: Partial<BaseProps> = { pixelate: 6, posterize: 6 };

/** Easing that moves in `steps` jumps, like sprite animation. */
export function stepped(steps: number): Ease {
  return (t: number) => Math.min(1, Math.floor(t * steps) / steps);
}

/** A full-frame group with the pixel look; add the scene's content to it. */
export function pixelStage(width: number, height: number, init: NodeInit<BaseProps> = {}): GroupNode {
  return group({ name: "pixel-stage", width, height, ...look, ...init });
}

/**
 * A sprite drawn from a text grid: one character per pixel, `.` is transparent,
 * other characters look up `colors`. `cell` is the size of one sprite pixel.
 */
export function sprite(rows: string[], colors: Record<string, string>, cell: number, init: NodeInit<BaseProps> = {}): GroupNode {
  const width = Math.max(...rows.map((r) => r.length)) * cell;
  const g = group({ name: "sprite", width, height: rows.length * cell, ...init });
  rows.forEach((row, y) => {
    // merge runs of the same colour into one rect
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== "." && colors[ch]) {
        g.add(rect({ name: `p${y}-${x}`, x: x * cell, y: y * cell, width: (end - x) * cell, height: cell, fill: colors[ch] }));
      }
      x = end;
    }
  });
  return g;
}

/** Blocky text with a hard one-step drop shadow. */
export function pixelText(label: string, size: number, init: NodeInit<BaseProps> & { color?: string; shadow?: string } = {}): GroupNode {
  const { color = theme.colors.paper, shadow = theme.colors.ink, ...rest } = init;
  const g = group({ name: "pixel-text", ...rest });
  const common = { text: label, fontFamily: theme.fonts.pixel, fontSize: size, fontWeight: 800, anchorX: 0.5, anchorY: 0.5 };
  g.add(text({ name: "shadow", ...common, x: size * 0.12, y: size * 0.12, color: shadow }));
  g.add(text({ name: "face", ...common, color }));
  return g;
}

/** Sprite sheets used by the demo; reuse or replace them. */
export const sprites = {
  hero: [
    "..rrrr..",
    ".rrrrrr.",
    ".ssbsbs.",
    ".ssssss.",
    "..bbbb..",
    ".bbbbbb.",
    ".b.bb.b.",
    "..d..d..",
  ],
  coin: [".gg.", "gyyg", "gyyg", ".gg."],
  heart: [".r.r.", "rrrrr", "rrrrr", ".rrr.", "..r.."],
  cloud: ["..ww....", ".wwwww..", "wwwwwwww", ".wwwwww."],
};

export const spriteColors: Record<string, string> = {
  r: theme.colors.red,
  s: "#ffccaa",
  b: theme.colors.night,
  d: theme.colors.ink,
  g: theme.colors.orange,
  y: theme.colors.gold,
  w: theme.colors.paper,
};
