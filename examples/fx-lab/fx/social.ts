/**
 * Social-video components: word-synced captions, split-screen duels and
 * confetti. These are the shapes you see in Reels/Shorts/TikTok edits.
 */

import { circle, group, image, rect, seededRandom, text, type GroupNode } from "liosvideo";
import { fonts, palette } from "./theme";
import type { EaseName } from "liosvideo";

export interface CaptionWord {
  text: string;
  /** seconds, scene-local */
  start: number;
  /** seconds, scene-local */
  end: number;
}

/**
 * Karaoke-style caption row: each word lights up on its cue and settles back.
 * Word positions are centred around `x` using a monospace advance estimate.
 */
export function karaokeCaption(
  parent: GroupNode,
  opts: {
    words: CaptionWord[];
    x: number;
    y: number;
    at?: number;
    size?: number;
    color?: string;
    activeColor?: string;
    dimColor?: string;
    gap?: number;
    fontFamily?: string;
    name?: string;
  },
): GroupNode {
  const size = opts.size ?? 44;
  const gap = opts.gap ?? size * 0.42;
  const color = opts.color ?? palette.text;
  const activeColor = opts.activeColor ?? palette.amber;
  const dimColor = opts.dimColor ?? palette.dim;
  const charWidth = size * 0.68;

  const box = parent.add(group({ name: opts.name ?? "karaoke-caption", width: 0, height: 0 }));
  const nodes = opts.words.map((word, i) =>
    box.add(
      text({
        name: `caption-${i}`,
        text: word.text,
        x: 0,
        y: opts.y,
        anchorX: 0.5,
        anchorY: 0.5,
        fontFamily: opts.fontFamily ?? fonts.sans,
        fontSize: size,
        fontWeight: 700,
        color: dimColor,
      }),
    ),
  );

  // real glyph widths (host measurer) keep the row tight for any font
  const widths = nodes.map((node, i) => {
    const measured = node.propsAt(0).width;
    return Math.max(1, measured > 0 ? measured : opts.words[i].text.length * charWidth);
  });
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
  let cursor = opts.x - total / 2;

  nodes.forEach((node, i) => {
    const center = cursor + widths[i] / 2;
    const start = (opts.at ?? 0) + opts.words[i].start;
    const end = (opts.at ?? 0) + opts.words[i].end;
    node.set({ x: center, color: dimColor, scaleX: 1, scaleY: 1 }, 0);
    node.set({ color: activeColor, scaleX: 1.08, scaleY: 1.08 }, start);
    node.set({ color, scaleX: 1, scaleY: 1 }, end);
    cursor += widths[i] + gap;
  });

  return box;
}

export interface VersusSide {
  label: string;
  sub?: string;
  score: number;
  color: string;
  /** Optional project-relative photo used as the lane background. */
  imageSrc?: string;
}

/** Split-screen comparison with a centre divider, VS badge and score roll. */
export function versusSplit(
  parent: GroupNode,
  opts: {
    width: number;
    height: number;
    top: VersusSide;
    bottom: VersusSide;
    axis?: "vertical" | "horizontal";
    at?: number;
    duration?: number;
    ease?: EaseName;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.5;
  const axis = opts.axis ?? "vertical";
  const root = parent.add(
    group({ name: opts.name ?? "versus", width: opts.width, height: opts.height }),
  );

  const laneSize = (index: 0 | 1) => {
    const w = axis === "vertical" ? opts.width : opts.width / 2;
    const h = axis === "vertical" ? opts.height / 2 : opts.height;
    const x = axis === "vertical" ? 0 : index * w;
    const y = axis === "vertical" ? index * h : 0;
    return { w, h, x, y };
  };

  const scores: Array<ReturnType<typeof text>> = [];

  (["top", "bottom"] as const).forEach((key, index) => {
    const side = opts[key];
    const { w, h, x, y } = laneSize(index as 0 | 1);
    const lane = root.add(group({ name: `lane-${key}`, x, y, width: w, height: h }));

    lane.add(rect({ name: "bg", width: w, height: h, fill: side.color }));
    if (side.imageSrc) {
      lane.add(image({ name: "photo", width: w, height: h, src: side.imageSrc, fit: "cover" }));
    }
    lane.add(
      rect({ name: "shade", width: w, height: h, fill: "#000000", opacity: side.imageSrc ? 0.55 : 0.42 }),
    );
    lane.add(
      text({
        name: "label",
        text: side.label,
        x: w / 2,
        y: h / 2 - h * 0.28,
        anchorX: 0.5,
        fontFamily: fonts.display,
        fontSize: Math.min(w * 0.14, 72),
        fontWeight: 400,
        color: "#FFFFFF",
      }),
    );
    lane.add(
      text({
        name: "sub",
        text: side.sub ?? "",
        x: w / 2,
        y: h / 2 + h * 0.3,
        anchorX: 0.5,
        fontFamily: fonts.mono,
        fontSize: Math.min(w * 0.026, 14),
        color: "#FFFFFFB3",
      }),
    );
    const score = lane.add(
      text({
        name: "score",
        text: "0",
        x: w / 2,
        y: h / 2 - h * 0.12,
        anchorX: 0.5,
        fontFamily: fonts.mono,
        fontSize: Math.min(w * 0.16, 92),
        fontWeight: 700,
        color: "#FFFFFF",
      }),
    );
    for (let s = 1; s <= 14; s++) {
      const p = s / 14;
      const eased = 1 - (1 - p) ** 3;
      score.set({ text: String(Math.round(side.score * eased)) }, at + 0.2 + 0.8 * p);
    }
    scores.push(score);

    // lanes slide in from their outer edge
    const offset = axis === "vertical" ? (index === 0 ? -h * 0.35 : h * 1.35) : index === 0 ? -w * 0.35 : w * 1.35;
    const target = axis === "vertical" ? y : x;
    const ease = opts.ease ?? "outCubic";
    if (axis === "vertical") {
      lane.set({ y: offset, opacity: 0 }, 0);
      lane.to({ y: target, opacity: 1 }, { at: at + index * 0.07, duration, ease });
    } else {
      lane.set({ x: offset, opacity: 0 }, 0);
      lane.to({ x: target, opacity: 1 }, { at: at + index * 0.07, duration, ease });
    }
  });

  const divider =
    axis === "vertical"
      ? root.add(rect({ name: "divider", x: 0, y: opts.height / 2 - 3, width: 0, height: 6, fill: "#FFFFFF" }))
      : root.add(rect({ name: "divider", x: opts.width / 2 - 3, y: 0, width: 6, height: 0, fill: "#FFFFFF" }));
  divider.to(
    axis === "vertical" ? { width: opts.width } : { height: opts.height },
    { at: at + 0.3, duration: 0.45, ease: "outCubic" },
  );

  const badge = root.add(
    group({
      name: "vs-badge",
      x: opts.width / 2,
      y: opts.height / 2,
      width: 76,
      height: 76,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0,
    }),
  );
  badge.add(
    circle({
      name: "badge-bg",
      radius: 38,
      x: 38,
      y: 38,
      anchorX: 0.5,
      anchorY: 0.5,
      fill: "#0B0E13",
      stroke: "#FFFFFF",
      strokeWidth: 2,
    }),
  );
  badge.add(
    text({
      name: "badge-label",
      text: "VS",
      x: 38,
      y: 22,
      anchorX: 0.5,
      fontFamily: fonts.sans,
      fontSize: 28,
      fontWeight: 700,
      color: "#FFFFFF",
    }),
  );
  badge.set({ scaleX: 0.6, scaleY: 0.6 }, 0);
  badge.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: at + 0.35, duration: 0.35, ease: "outBack" });

  return root;
}

/** Deterministic confetti burst. */
export function confetti(
  parent: GroupNode,
  opts: {
    width: number;
    height: number;
    count?: number;
    at?: number;
    duration?: number;
    seed?: number;
    colors?: string[];
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const count = opts.count ?? 30;
  const duration = opts.duration ?? 2.4;
  const colors = opts.colors ?? [palette.amber, palette.rose, palette.cyan, palette.emerald, palette.violet];
  const rand = seededRandom(String(opts.seed ?? 5));
  const box = parent.add(group({ name: opts.name ?? "confetti", width: opts.width, height: opts.height }));

  for (let i = 0; i < count; i++) {
    const x = rand() * opts.width;
    const delay = rand() * 0.55;
    const w = 8 + rand() * 9;
    const h = 13 + rand() * 15;
    const spin = rand() * 360;
    const drift = (rand() - 0.5) * 220;
    const fall = duration * (0.75 + rand() * 0.45);
    const piece = box.add(
      rect({
        name: `confetti-${i}`,
        x,
        y: -60,
        width: w,
        height: h,
        radius: 2,
        fill: colors[i % colors.length],
        opacity: 0,
      }),
    );
    piece.set({ opacity: 0, rotation: spin }, 0);
    piece.to({ opacity: 1 }, { at: at + delay, duration: 0.12 });
    piece.to(
      { y: opts.height + 80, x: x + drift, rotation: spin + 540, opacity: 0 },
      { at: at + delay + 0.1, duration: fall, ease: "linear" },
    );
  }
  return box;
}
