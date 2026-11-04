/**
 * The FX playbook — the whole kit on one 1920x1080 page.
 *
 * Each tile is a live, deterministic demo built from the reusable components
 * in `fx/`. The page is intentionally a single composition so it can be
 * rendered, screenshotted, or used as a reference board.
 */

import { group, rect, scene, shader, text } from "liosvideo";
import {
  archetypes,
  chip,
  fadeIn,
  fonts,
  grainOverlay,
  palette,
  popIn,
  pulse,
  rgb,
  slideIn,
  vignette,
} from "../fx";
import { FX_CATALOG } from "../fx/catalog";
import { CLIPPED_TILES, FX_TILES } from "./tiles";
import { GRID, PAGE, tileDemo, tileEnter, tileOrigin } from "./timing";
import type { GroupNode } from "liosvideo";
import type { FxEntry } from "../fx/catalog";

const TILE_RADIUS = 16;

function buildTile(root: GroupNode, entry: FxEntry, index: number): void {
  const origin = tileOrigin(index);
  const accent = archetypes[entry.archetype].color;
  const enter = tileEnter(index);
  const demo = tileDemo(index);

  const box = root.add(
    group({
      name: `tile-${entry.id}`,
      x: origin.x + GRID.tileW / 2,
      y: origin.y + GRID.tileH / 2,
      width: GRID.tileW,
      height: GRID.tileH,
      anchorX: 0.5,
      anchorY: 0.5,
    }),
  );

  box.add(
    rect({
      name: "surface",
      width: GRID.tileW,
      height: GRID.tileH,
      radius: TILE_RADIUS,
      fill: palette.panel,
      stroke: palette.border,
      strokeWidth: 1,
    }),
  );
  box.add(
    rect({
      name: "accent-bar",
      x: 18,
      y: 1,
      width: 46,
      height: 2,
      radius: 1,
      fill: accent,
      opacity: 0.9,
    }),
  );
  box.add(
    text({
      name: "category",
      text: entry.category.toUpperCase(),
      x: 18,
      y: 16,
      fontFamily: fonts.mono,
      fontSize: 9,
      color: palette.dim,
    }),
  );
  box.add(
    text({
      name: "index",
      text: `#${String(index + 1).padStart(2, "0")}`,
      x: GRID.tileW - 18,
      y: 16,
      anchorX: 1,
      fontFamily: fonts.mono,
      fontSize: 9,
      fontWeight: 700,
      color: accent,
    }),
  );

  box.add(
    rect({
      name: "stage-frame",
      x: 18,
      y: 44,
      width: 390,
      height: 148,
      radius: 10,
      fill: palette.panelDeep,
      stroke: palette.borderSoft,
      strokeWidth: 1,
    }),
  );

  const stage = box.add(
    group({
      name: "stage",
      x: 18,
      y: 44,
      width: 390,
      height: 148,
      radius: 10,
      clip: CLIPPED_TILES.has(entry.id),
    }),
  );

  const build = FX_TILES[entry.id];
  if (!build) throw new Error(`No tile builder for FX "${entry.id}"`);
  build({ stage, at: demo, accent });

  box.add(
    text({
      name: "title",
      text: entry.name,
      x: 18,
      y: 203,
      fontSize: 19,
      fontWeight: 700,
      fontFamily: fonts.sans,
      color: palette.text,
    }),
  );
  box.add(
    text({
      name: "blurb",
      text: entry.blurb,
      x: 18,
      y: 232,
      fontSize: 10.5,
      fontFamily: fonts.sans,
      color: palette.muted,
    }),
  );

  popIn(box, { at: enter, duration: 0.45, from: 0.9 });
  pulse(box, { at: 5.2 + index * 0.05, times: 1, duration: 0.16, scale: 1.015 });
}

export default scene(
  "fx-playbook",
  { duration: PAGE.duration, background: palette.bg },
  ({ root, width, height }) => {
    root.add(rect({ name: "bg", width, height, fill: palette.bg }));

    const [gr, gg, gb] = rgb(palette.cyan);
    root.add(
      shader({
        name: "page-glow",
        width,
        height,
        uniforms: { color: [gr, gg, gb, 1], strength: 0.11 },
        code: `
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = u_globals.time.x;
  let drift = vec2f(0.006 * sin(t * 0.35), 0.004 * cos(t * 0.28));
  let d = distance(uv * vec2f(1.0, 1.7), vec2f(0.5, 0.0) + drift);
  let a = smoothstep(0.95, 0.0, d) * u.strength.x;
  return vec4f(u.color.rgb * a, a);
}`,
      }),
    );

    // ---------------------------------------------------------------- header
    const eyebrow = root.add(
      text({
        name: "eyebrow",
        text: "LIOSVIDEO / MOTION KIT",
        x: 80,
        y: 36,
        fontFamily: fonts.mono,
        fontSize: 10,
        fontWeight: 700,
        color: palette.cyan,
        opacity: 0,
      }),
    );
    fadeIn(eyebrow, { at: 0.05, duration: 0.4 });

    root.add(
      rect({ name: "title-bar", x: 62, y: 56, width: 4, height: 40, radius: 2, fill: palette.amber }),
    );

    const title = root.add(
      text({
        name: "title",
        text: "FX PLAYBOOK",
        x: 80,
        y: 50,
        fontSize: 52,
        fontWeight: 700,
        fontFamily: fonts.serif,
        color: palette.text,
        opacity: 0,
      }),
    );
    title.set({ x: 66 }, 0);
    slideIn(title, { at: 0.1, duration: 0.55, from: "left", distance: 22 });

    const subtitle = root.add(
      text({
        name: "subtitle",
        text: "12 efek sinematik siap pakai — dipetakan ke DNA kreator Indonesia.",
        x: 80,
        y: 112,
        fontSize: 13,
        fontFamily: fonts.sans,
        color: palette.muted,
        opacity: 0,
      }),
    );
    fadeIn(subtitle, { at: 0.35, duration: 0.5 });

    const meta = root.add(
      text({
        name: "meta",
        text: "1920 × 1080  ·  30 FPS  ·  DETERMINISTIC",
        x: width - 72,
        y: 62,
        anchorX: 1,
        fontFamily: fonts.mono,
        fontSize: 10,
        color: palette.dim,
        opacity: 0,
      }),
    );
    fadeIn(meta, { at: 0.3, duration: 0.5 });

    // archetype legend, right aligned
    const legend = Object.values(archetypes);
    const legendSize = 9;
    const gap = 16;
    const widths = legend.map((a) => Math.ceil(a.label.length * legendSize * 0.68 + 14));
    const total = widths.reduce((sum, w) => sum + w, 0) + gap * (legend.length - 1);
    let cursor = width - 72 - total;
    legend.forEach((entry, i) => {
      chip(root, {
        label: entry.label,
        x: cursor,
        y: 112,
        at: 0.32 + i * 0.06,
        color: entry.color,
        size: legendSize,
      });
      cursor += widths[i] + gap;
    });

    const divider = root.add(
      rect({ name: "divider", x: 72, y: 164, width: 0, height: 1, fill: palette.border }),
    );
    divider.to({ width: width - 144 }, { at: 0.25, duration: 0.7, ease: "outCubic" });

    // ----------------------------------------------------------------- grid
    FX_CATALOG.filter((entry) => entry.volume === 1).forEach((entry, index) =>
      buildTile(root, entry, index),
    );

    // ------------------------------------------------------------- outro FX
    const sweep = root.add(
      rect({
        name: "sweep",
        x: 72,
        y: 162,
        width: 0,
        height: 2,
        radius: 1,
        fill: palette.cyan,
        opacity: 0,
        anchorX: 0,
      }),
    );
    sweep.set({ opacity: 0 }, 4.35);
    sweep.to({ opacity: 0.85, width: width - 144 }, { at: 4.4, duration: 0.9, ease: "inOutCubic" });
    sweep.to({ opacity: 0 }, { at: 5.35, duration: 0.45 });

    const footerLeft = root.add(
      text({
        name: "footer-left",
        text: "liosvideo · deterministic by design",
        x: 72,
        y: 1036,
        fontFamily: fonts.mono,
        fontSize: 10,
        color: palette.dim,
        opacity: 0,
      }),
    );
    fadeIn(footerLeft, { at: 5.6, duration: 0.5 });

    const footerRight = root.add(
      text({
        name: "footer-right",
        text: "grain · paper · glitch · type · camera · ui",
        x: width - 72,
        y: 1036,
        anchorX: 1,
        fontFamily: fonts.mono,
        fontSize: 10,
        color: palette.dim,
        opacity: 0,
      }),
    );
    fadeIn(footerRight, { at: 5.7, duration: 0.5 });

    // ------------------------------------------------------------ page polish
    vignette(root, { width, height, strength: 0.4, name: "page-vignette" });
    grainOverlay(root, { width, height, amount: 0.07, at: 0, name: "page-grain" });
  },
);
