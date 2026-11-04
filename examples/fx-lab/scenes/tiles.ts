/**
 * The twelve demo tiles rendered by the FX playbook page.
 *
 * Each builder receives a 390x148 stage clipped by the page, plus the scene
 * time at which the tile starts. Everything is deterministic keyframes.
 */

import { circle, group, image, rect, text, type GroupNode } from "liosvideo";
import {
  countUp,
  crashZoom,
  dustMotes,
  fadeIn,
  grainOverlay,
  glitchRGB,
  highlighter,
  kineticWord,
  lightPool,
  letterbox,
  lowerThird,
  palette,
  pillBadge,
  scanlines,
  shake,
  stampText,
  speedLines,
  spotlight,
  ticker,
  tornPaper,
  typewriter,
  fonts,
} from "../fx";

export const STAGE_W = 390;
export const STAGE_H = 148;

export interface TileContext {
  stage: GroupNode;
  /** Scene-local second at which this tile's demo begins. */
  at: number;
  accent: string;
}

export type TileBuilder = (ctx: TileContext) => void;

export const FX_TILES: Record<string, TileBuilder> = {
  "film-grain": ({ stage, at, accent }) => {
    stage.add(
      image({
        name: "archive-photo",
        width: STAGE_W,
        height: STAGE_H,
        src: "assets/images/old-newspaper-detail.jpg",
        fit: "fill",
      }),
    );
    stage.add(rect({ name: "grade", width: STAGE_W, height: STAGE_H, fill: "#0A0C10", opacity: 0.26 }));
    stage.add(rect({ name: "scrim", x: 0, y: 0, width: 240, height: STAGE_H, fill: "#07080B", opacity: 0.28 }));
    grainOverlay(stage, { width: STAGE_W, height: STAGE_H, at, amount: 0.22 });
    scanlines(stage, { width: STAGE_W, height: STAGE_H, at, strength: 0.12, pitch: 3 });

    const title = stage.add(
      text({
        name: "archive-title",
        text: "ARSIP 1998",
        x: 22,
        y: 34,
        fontFamily: fonts.serif,
        fontSize: 30,
        fontWeight: 700,
        color: "#EFE6D2",
        opacity: 0,
      }),
    );
    fadeIn(title, { at: at + 0.3, duration: 0.5 });

    const rule = stage.add(
      rect({ name: "archive-rule", x: 24, y: 74, width: 96, height: 1, fill: accent, opacity: 0 }),
    );
    fadeIn(rule, { at: at + 0.5, duration: 0.4 });

    const sub = stage.add(
      text({
        name: "archive-sub",
        text: "BERKAS NO. 04 / 35MM",
        x: 24,
        y: 82,
        fontFamily: fonts.mono,
        fontSize: 9,
        color: accent,
        opacity: 0,
      }),
    );
    fadeIn(sub, { at: at + 0.6, duration: 0.4 });
  },

  "paper-tear": ({ stage, at, accent }) => {
    tornPaper(stage, { width: STAGE_W, height: STAGE_H, at, accent, speed: 1.8 });

    const head = stage.add(
      text({
        name: "fact-head",
        text: "FAKTA",
        x: 112,
        y: 46,
        anchorX: 0.5,
        fontSize: 40,
        fontWeight: 400,
        fontFamily: fonts.display,
        color: accent,
        opacity: 0,
      }),
    );
    fadeIn(head, { at: at + 0.42, duration: 0.32 });

    const sub = stage.add(
      text({
        name: "fact-sub",
        text: "BUKAN OPINI",
        x: 112,
        y: 86,
        anchorX: 0.5,
        fontSize: 9,
        fontFamily: fonts.mono,
        color: "#A9B2C2",
        opacity: 0,
      }),
    );
    fadeIn(sub, { at: at + 0.58, duration: 0.32 });
  },

  typewriter: ({ stage, at, accent }) => {
    const line = typewriter(stage, {
      text: "Data tidak berbohong.",
      x: 20,
      y: 52,
      fontSize: 19,
      color: palette.text,
      at: at + 0.02,
      duration: 1.0,
      cursorColor: accent,
    });

    highlighter(stage, {
      textNode: line.text,
      at: at + 0.95,
      opacity: 0.26,
      color: accent,
      padding: 8,
    });

    const sig = stage.add(
      text({
        name: "signature",
        text: "— catatan riset / 03",
        x: 20,
        y: 100,
        fontFamily: fonts.mono,
        fontSize: 10,
        color: palette.dim,
        opacity: 0,
      }),
    );
    fadeIn(sig, { at: at + 1.2, duration: 0.4 });
  },

  "kinetic-caption": ({ stage, at, accent }) => {
    const tag = stage.add(
      text({
        name: "sync-tag",
        text: "BEAT-LOCKED CAPTION",
        x: 20,
        y: 18,
        fontFamily: fonts.mono,
        fontSize: 9,
        color: palette.dim,
        opacity: 0,
      }),
    );
    fadeIn(tag, { at: at + 0.1, duration: 0.3 });

    const words: Array<[string, number]> = [
      ["INI", 66],
      ["BUKAN", 195],
      ["MITOS", 322],
    ];
    words.forEach(([word, x], i) => {
      kineticWord(stage, {
        word,
        x,
        y: 82,
        at: at + 0.14 + i * 0.34,
        size: 27,
        accent,
      });
    });
  },

  "crash-zoom": ({ stage, at, accent }) => {
    const content = stage.add(
      group({
        name: "zoom-content",
        x: STAGE_W / 2,
        y: STAGE_H / 2,
        width: STAGE_W,
        height: STAGE_H,
        anchorX: 0.5,
        anchorY: 0.5,
      }),
    );
    content.add(
      image({
        name: "zoom-photo",
        width: STAGE_W,
        height: STAGE_H,
        src: "assets/images/road-cycling.jpg",
        fit: "cover",
      }),
    );
    content.add(rect({ name: "zoom-grade", width: STAGE_W, height: STAGE_H, fill: "#0C1219", opacity: 0.25 }));
    content.add(
      circle({
        name: "subject-ring",
        radius: 54,
        x: 195,
        y: 74,
        anchorX: 0.5,
        anchorY: 0.5,
        fill: "#0C1219",
        stroke: accent,
        strokeWidth: 1.5,
        opacity: 0.0,
      }),
    );

    crashZoom(content, { at: at + 0.15, from: 1, to: 1.32, duration: 0.26 });
    shake(content, { at: at + 0.42, intensity: 5, duration: 0.34 });

    const flash = stage.add(rect({ name: "zoom-flash", width: STAGE_W, height: STAGE_H, fill: "#FFFFFF", opacity: 0 }));
    flash.to({ opacity: 0.2 }, { at: at + 0.41, duration: 0.05 });
    flash.to({ opacity: 0 }, { at: at + 0.46, duration: 0.24 });

    const zoomLabel = stage.add(
      text({
        name: "zoom-label",
        text: "1.34×",
        x: STAGE_W - 16,
        y: 14,
        anchorX: 1,
        fontFamily: fonts.mono,
        fontSize: 11,
        fontWeight: 700,
        color: accent,
        opacity: 0,
      }),
    );
    fadeIn(zoomLabel, { at: at + 0.45, duration: 0.3 });
  },

  "whip-pan": ({ stage, at, accent }) => {
    const panelA = stage.add(group({ name: "panel-a", x: 0, y: 0, width: STAGE_W, height: STAGE_H }));
    panelA.add(rect({ name: "a-bg", width: STAGE_W, height: STAGE_H, fill: "#13202E" }));
    panelA.add(
      text({
        name: "a-label",
        text: "SHOT A",
        x: STAGE_W / 2,
        y: STAGE_H / 2 - 20,
        anchorX: 0.5,
        fontFamily: fonts.display,
        fontSize: 34,
        fontWeight: 700,
        color: "#5D7086",
      }),
    );

    const panelB = stage.add(group({ name: "panel-b", x: STAGE_W, y: 0, width: STAGE_W, height: STAGE_H }));
    panelB.add(rect({ name: "b-bg", width: STAGE_W, height: STAGE_H, fill: "#2A1C10" }));
    panelB.add(
      text({
        name: "b-label",
        text: "SHOT B",
        x: STAGE_W / 2,
        y: STAGE_H / 2 - 20,
        anchorX: 0.5,
        fontFamily: fonts.display,
        fontSize: 34,
        fontWeight: 700,
        color: accent,
      }),
    );

    for (let i = 0; i < 5; i++) {
      const streak = stage.add(
        rect({
          name: `streak-${i}`,
          x: 20 + i * 74,
          y: 18 + i * 26,
          width: 54 + i * 16,
          height: 2,
          fill: accent,
          rotation: -12,
          opacity: 0,
        }),
      );
      streak.to({ opacity: 0.55 }, { at: at + 0.2, duration: 0.06 });
      streak.to({ opacity: 0 }, { at: at + 0.27, duration: 0.18 });
    }

    const t1 = at + 0.2;
    const t2 = at + 1.15;
    for (const [a, b, at2] of [
      [-STAGE_W, 0, t1],
      [0, STAGE_W, t2],
    ] as const) {
      panelA.to({ x: a }, { at: at2, duration: 0.28, ease: "outCubic" });
      panelB.to({ x: b }, { at: at2, duration: 0.28, ease: "outCubic" });
    }
  },

  "glitch-rgb": ({ stage, at, accent }) => {
    glitchRGB(stage, { width: STAGE_W, height: STAGE_H, at, amount: 0.6 });
    scanlines(stage, { width: STAGE_W, height: STAGE_H, at, strength: 0.16, pitch: 3 });

    const msg = stage.add(
      text({
        name: "signal",
        text: "SIGNAL LOST",
        x: STAGE_W / 2,
        y: 62,
        anchorX: 0.5,
        fontFamily: fonts.mono,
        fontSize: 20,
        fontWeight: 700,
        color: "#FFFFFF",
      }),
    );
    for (let i = 0; i < 7; i++) {
      msg.set({ x: STAGE_W / 2 + (i % 2 === 0 ? 7 : -7) }, at + 0.05 + i * 0.08);
    }
    msg.set({ x: STAGE_W / 2 }, at + 0.62);

    const err = stage.add(
      text({
        name: "err",
        text: "ERR 0x1F",
        x: 22,
        y: 120,
        fontFamily: fonts.mono,
        fontSize: 9,
        color: accent,
      }),
    );
    err.set({ opacity: 0.5 }, at);
    err.set({ opacity: 1 }, at + 0.4);
  },

  letterbox: ({ stage, at, accent }) => {
    stage.add(
      image({
        name: "frame-photo",
        width: STAGE_W,
        height: STAGE_H,
        src: "assets/images/misty-mountains.jpg",
        fit: "cover",
      }),
    );
    stage.add(rect({ name: "grade", width: STAGE_W, height: STAGE_H, fill: "#0A0C10", opacity: 0.28 }));

    letterbox(stage, { width: STAGE_W, height: STAGE_H, ratio: 0.17, at: at + 0.1, duration: 0.5 });

    const ratio = stage.add(
      text({
        name: "ratio",
        text: "2.39 : 1",
        x: STAGE_W - 14,
        y: STAGE_H - 18,
        anchorX: 1,
        fontFamily: fonts.mono,
        fontSize: 9,
        color: accent,
        opacity: 0,
      }),
    );
    fadeIn(ratio, { at: at + 0.52, duration: 0.3 });
  },

  "count-up": ({ stage, at, accent }) => {
    stage.add(rect({ name: "bg", width: STAGE_W, height: STAGE_H, radius: 10, fill: "#0E131A" }));

    countUp(stage, {
      from: 0,
      to: 128,
      x: 20,
      y: 24,
      size: 48,
      color: palette.text,
      at: at + 0.15,
      duration: 1.0,
    });

    stage.add(
      text({
        name: "metric-label",
        text: "RIBU PENONTON",
        x: 24,
        y: 84,
        fontFamily: fonts.mono,
        fontSize: 9,
        color: palette.dim,
      }),
    );

    const heights = [14, 22, 32, 44];
    heights.forEach((h, i) => {
      const bar = stage.add(
        rect({
          name: `bar-${i}`,
          x: 196 + i * 26,
          y: 118 - h,
          width: 14,
          height: 0,
          radius: 3,
          fill: i === heights.length - 1 ? accent : "#2B3949",
        }),
      );
      bar.to({ height: h }, { at: at + 0.3 + i * 0.08, duration: 0.3, ease: "outCubic" });
    });

    pillBadge(stage, {
      label: "+312%",
      x: 258,
      y: 26,
      at: at + 0.9,
      color: palette.emerald,
      bg: "#0F2A22",
    });
  },

  "impact-burst": ({ stage, at, accent }) => {
    speedLines(stage, {
      width: STAGE_W,
      height: STAGE_H,
      at,
      color: accent,
      strength: 0.72,
      count: 24,
    });

    const ring = stage.add(
      circle({
        name: "shock-ring",
        radius: 26,
        x: STAGE_W / 2,
        y: STAGE_H / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        fill: "#0B0E14",
        stroke: accent,
        strokeWidth: 3,
        opacity: 0,
      }),
    );
    ring.set({ scaleX: 0.4, scaleY: 0.4 }, at + 0.3);
    ring.to({ opacity: 0.95 }, { at: at + 0.31, duration: 0.02 });
    ring.to(
      { scaleX: 2.6, scaleY: 2.6, opacity: 0 },
      { at: at + 0.32, duration: 0.45, ease: "outCubic" },
    );

    const flash = stage.add(rect({ name: "impact-flash", width: STAGE_W, height: STAGE_H, fill: "#FFFFFF", opacity: 0 }));
    flash.to({ opacity: 0.85 }, { at: at + 0.31, duration: 0.03 });
    flash.to({ opacity: 0 }, { at: at + 0.35, duration: 0.3 });

    const label = stage.add(
      text({
        name: "impact-label",
        text: "IMPACT",
        x: STAGE_W / 2,
        y: STAGE_H / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        fontFamily: fonts.display,
        fontSize: 40,
        fontWeight: 700,
        color: "#FFFFFF",
      }),
    );
    stampText(label, { at: at + 0.31, from: 1.9, rotation: -9 });
  },

  "lower-third": ({ stage, at, accent }) => {
    stage.add(rect({ name: "bg", width: STAGE_W, height: STAGE_H, radius: 10, fill: "#0D1319" }));

    lowerThird(stage, {
      name: "FERRY IRWANDI",
      role: "VIDEO ESSAYIST · TIM MALAKA",
      x: 12,
      y: 42,
      width: 306,
      at: at + 0.1,
      accent,
    });

    ticker(stage, {
      text: "SUMBER: ARSIP NASIONAL · DATA BPS 2024 · METODOLOGI TERBUKA · ",
      x: 12,
      y: 112,
      width: 366,
      at: at + 0.14,
      speed: 40,
      startX: 56,
      fontSize: 10,
      color: palette.muted,
      bg: "#0A0F15",
    });
  },

  spotlight: ({ stage, at, accent }) => {
    stage.add(
      image({
        name: "spot-photo",
        width: STAGE_W,
        height: STAGE_H,
        src: "assets/images/library-books.jpg",
        fit: "cover",
      }),
    );
    stage.add(rect({ name: "grade", width: STAGE_W, height: STAGE_H, fill: "#07090C", opacity: 0.55 }));
    lightPool(stage, {
      width: STAGE_W,
      height: STAGE_H,
      at,
      center: [0.5, 0.5],
      radius: 0.7,
      drift: 0.05,
      strength: 0.4,
    });

    dustMotes(stage, {
      width: STAGE_W,
      height: STAGE_H,
      count: 10,
      seed: 12,
      at: at + 0.15,
      duration: 1.4,
      color: "#E8DCC0",
    });

    spotlight(stage, {
      width: STAGE_W,
      height: STAGE_H,
      at,
      center: [0.5, 0.5],
      radius: 0.7,
      drift: 0.05,
      strength: 0.78,
    });

    const label = stage.add(
      text({
        name: "focus-label",
        text: "FOKUS",
        x: STAGE_W / 2,
        y: STAGE_H - 20,
        anchorX: 0.5,
        fontFamily: fonts.mono,
        fontSize: 9,
        fontWeight: 700,
        color: accent,
        opacity: 0,
      }),
    );
    fadeIn(label, { at: at + 0.45, duration: 0.35 });
  },
};

/** Tiles whose content can leave the stage bounds. */
export const CLIPPED_TILES = new Set([
  "film-grain",
  "paper-tear",
  "glitch-rgb",
  "letterbox",
  "whip-pan",
  "crash-zoom",
  "lower-third",
]);
