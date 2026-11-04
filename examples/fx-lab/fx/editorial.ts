/**
 * Editorial components: quote cards, chapter cards, polaroid collage frames
 * and the "breaking news" banner used across Indonesian video essays.
 */

import { circle, group, image, rect, text, type GroupNode } from "liosvideo";
import { fonts, palette } from "./theme";

/** Serif pull-quote with attribution. */
export function quoteCard(
  parent: GroupNode,
  opts: {
    lines: string[];
    author: string;
    role?: string;
    x: number;
    y: number;
    at?: number;
    size?: number;
    color?: string;
    accent?: string;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const size = opts.size ?? 46;
  const color = opts.color ?? "#EFE6D2";
  const accent = opts.accent ?? palette.amber;
  const box = parent.add(group({ name: opts.name ?? "quote-card", width: 0, height: 0 }));

  box.add(
    text({
      name: "mark",
      text: "“",
      x: opts.x - 8,
      y: opts.y - 54,
      fontFamily: fonts.serif,
      fontSize: 150,
      color: accent,
      opacity: 0.32,
    }),
  );

  opts.lines.forEach((line, i) => {
    const node = box.add(
      text({
        name: `line-${i}`,
        text: line,
        x: opts.x,
        y: opts.y + i * size * 1.28,
        fontFamily: fonts.serif,
        fontSize: size,
        color,
        opacity: 0,
      }),
    );
    node.to({ opacity: 1, y: node.propsAt(0).y - 10 }, { at: at + i * 0.13, duration: 0.55, ease: "outCubic" });
  });

  const ruleY = opts.y + opts.lines.length * size * 1.28 + 26;
  const rule = box.add(rect({ name: "rule", x: opts.x, y: ruleY, width: 0, height: 2, fill: accent }));
  rule.to({ width: 180 }, { at: at + 0.3, duration: 0.5, ease: "outCubic" });

  box.add(
    text({
      name: "author",
      text: opts.author,
      x: opts.x,
      y: ruleY + 24,
      fontFamily: fonts.mono,
      fontSize: 18,
      fontWeight: 700,
      color: accent,
    }),
  );
  if (opts.role) {
    box.add(
      text({
        name: "role",
        text: opts.role,
        x: opts.x,
        y: ruleY + 52,
        fontFamily: fonts.mono,
        fontSize: 13,
        color: palette.dim,
      }),
    );
  }
  return box;
}

/** Numbered chapter card (BAB 01) with a rule and progress dots. */
export function chapterCard(
  parent: GroupNode,
  opts: {
    index: number;
    total?: number;
    kicker?: string;
    title: string;
    x: number;
    y: number;
    at?: number;
    accent?: string;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const total = opts.total ?? 5;
  const accent = opts.accent ?? palette.amber;
  const box = parent.add(group({ name: opts.name ?? "chapter-card", width: 0, height: 0 }));

  const number = box.add(
    text({
      name: "number",
      text: String(opts.index).padStart(2, "0"),
      x: opts.x,
      y: opts.y,
      fontFamily: fonts.serif,
      fontSize: 168,
      fontWeight: 700,
      color: accent,
      opacity: 0,
    }),
  );
  number.to({ opacity: 0.95 }, { at, duration: 0.4 });

  box.add(
    text({
      name: "total",
      text: `/ ${String(total).padStart(2, "0")}`,
      x: opts.x + 210,
      y: opts.y + 106,
      fontFamily: fonts.mono,
      fontSize: 20,
      color: palette.dim,
    }),
  );

  if (opts.kicker) {
    box.add(
      text({
        name: "kicker",
        text: opts.kicker.toUpperCase(),
        x: opts.x + 4,
        y: opts.y + 210,
        fontFamily: fonts.mono,
        fontSize: 14,
        fontWeight: 700,
        color: accent,
      }),
    );
  }

  box.add(
    text({
      name: "title",
      text: opts.title,
      x: opts.x,
      y: opts.y + 236,
      fontFamily: fonts.sans,
      fontSize: 44,
      fontWeight: 700,
      color: palette.text,
    }),
  );

  const rule = box.add(rect({ name: "rule", x: opts.x, y: opts.y + 300, width: 0, height: 2, fill: palette.border }));
  rule.to({ width: 420 }, { at: at + 0.2, duration: 0.5, ease: "outCubic" });

  const dotGap = 26;
  for (let i = 0; i < total; i++) {
    box.add(
      circle({
        name: `dot-${i}`,
        radius: 5,
        x: opts.x + 5 + i * dotGap,
        y: opts.y + 330,
        anchorX: 0.5,
        anchorY: 0.5,
        fill: i + 1 === opts.index ? accent : palette.border,
      }),
    );
  }

  return box;
}

/** Rotated instant-photo card with tape, for collage / archival sequences. */
export function polaroidFrame(
  parent: GroupNode,
  opts: {
    width: number;
    height: number;
    x: number;
    y: number;
    at?: number;
    rotation?: number;
    caption?: string;
    tint?: string;
    body?: string;
    /** Optional project-relative photo; otherwise a tinted placeholder is drawn. */
    imageSrc?: string;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const w = opts.width;
  const h = opts.height;
  const rotation = opts.rotation ?? -5;
  const tint = opts.tint ?? "#26313F";

  const card = parent.add(
    group({
      name: opts.name ?? "polaroid",
      x: opts.x + w / 2,
      y: opts.y + h / 2,
      width: w,
      height: h,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation,
    }),
  );

  card.add(
    rect({ name: "shadow", x: 10, y: 14, width: w, height: h, radius: 4, fill: "#000000", opacity: 0.35 }),
  );
  card.add(rect({ name: "paper", width: w, height: h, radius: 4, fill: "#F1EDE3" }));
  card.add(rect({ name: "photo", x: 14, y: 14, width: w - 28, height: h - 78, fill: tint }));
  if (opts.imageSrc) {
    card.add(
      image({
        name: "photo-image",
        x: 14,
        y: 14,
        width: w - 28,
        height: h - 78,
        src: opts.imageSrc,
        fit: "cover",
      }),
    );
  } else {
    card.add(
      circle({
        name: "photo-subject",
        radius: (w - 28) * 0.22,
        x: 14 + (w - 28) / 2,
        y: 14 + (h - 78) / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        fill: opts.body ?? "#7E93AB",
      }),
    );
  }
  card.add(
    text({
      name: "caption",
      text: opts.caption ?? "ARSIP · 1998",
      x: 18,
      y: h - 50,
      fontFamily: fonts.mono,
      fontSize: 16,
      color: "#2E2A24",
    }),
  );

  card.add(
    rect({
      name: "tape",
      x: w / 2 - 56,
      y: -15,
      width: 112,
      height: 30,
      fill: "#FFFFFF",
      opacity: 0.9,
      rotation: -3,
    }),
  );

  card.set({ opacity: 0, scaleX: 0.9, scaleY: 0.9, rotation: rotation - 7 }, 0);
  card.to(
    { opacity: 1, scaleX: 1, scaleY: 1, rotation },
    { at, duration: 0.5, ease: "outBack" },
  );

  return card;
}

/** Red news banner with a blinking dot and a headline. */
export function breakingBanner(
  parent: GroupNode,
  opts: {
    width: number;
    y: number;
    headline: string;
    at?: number;
    height?: number;
    color?: string;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const height = opts.height ?? 56;
  const color = opts.color ?? "#C81E2B";
  const labelWidth = 232;

  const banner = parent.add(
    group({ name: opts.name ?? "breaking-banner", x: 0, y: opts.y, width: opts.width, height }),
  );
  banner.add(rect({ name: "bg", width: opts.width, height, fill: color }));
  banner.add(rect({ name: "label-bg", width: labelWidth, height, fill: "#8E131D" }));

  const dot = banner.add(
    circle({ name: "live-dot", radius: 7, x: 22, y: height / 2, anchorX: 0.5, anchorY: 0.5, fill: "#FFFFFF" }),
  );
  dot.set({ opacity: 1 }, 0);
  for (let i = 0; i < 6; i++) {
    dot.set({ opacity: 0.15 }, at + 0.4 + i * 0.4);
    dot.set({ opacity: 1 }, at + 0.6 + i * 0.4);
  }

  banner.add(
    text({
      name: "label",
      text: "BREAKING",
      x: 42,
      y: (height - 26) / 2,
      fontFamily: fonts.display,
      fontSize: 30,
      fontWeight: 400,
      color: "#FFFFFF",
    }),
  );
  banner.add(
    text({
      name: "headline",
      text: opts.headline,
      x: labelWidth + 28,
      y: (height - 20) / 2,
      fontFamily: fonts.sans,
      fontSize: 20,
      fontWeight: 700,
      color: "#FFFFFF",
    }),
  );

  const targetY = opts.y;
  banner.set({ y: targetY - height, opacity: 0 }, 0);
  banner.to({ y: targetY, opacity: 1 }, { at, duration: 0.42, ease: "outCubic" });
  return banner;
}
