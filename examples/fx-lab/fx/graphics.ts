/**
 * Small graphic components reused across scenes: pills, chips, progress bars,
 * callouts, corner brackets and ticker rows.
 */

import { circle, group, rect, text, type GroupNode, type RectNode } from "liosvideo";
import { fonts, palette } from "./theme";

export interface PillBadgeOptions {
  label: string;
  x: number;
  y: number;
  at?: number;
  size?: number;
  color?: string;
  bg?: string;
  height?: number;
  paddingX?: number;
  radius?: number;
  name?: string;
}

/** Fully-rounded badge. Returns the container group. */
export function pillBadge(parent: GroupNode, opts: PillBadgeOptions): GroupNode {
  const at = opts.at ?? 0;
  const size = opts.size ?? 11;
  const height = opts.height ?? 24;
  const paddingX = opts.paddingX ?? 10;
  const width = Math.ceil(opts.label.length * size * 0.63 + paddingX * 2);
  const color = opts.color ?? palette.emerald;
  const bg = opts.bg ?? "#11251F";

  const box = parent.add(
    group({ name: opts.name ?? "pill", x: opts.x, y: opts.y, width, height, opacity: 0 }),
  );
  const bgRect = box.add(
    rect({
      name: "bg",
      width,
      height,
      radius: opts.radius ?? height / 2,
      fill: bg,
      stroke: color,
      strokeWidth: 1,
    }),
  );
  const labelNode = box.add(
    text({
      name: "label",
      text: opts.label,
      x: width / 2,
      y: (height - size * 1.25) / 2,
      anchorX: 0.5,
      fontSize: size,
      fontFamily: fonts.mono,
      fontWeight: 700,
      color,
    }),
  );
  const measured = labelNode.propsAt(0).width;
  if (measured > 0) {
    const fitted = Math.ceil(measured + paddingX * 2);
    bgRect.set({ width: fitted }, 0);
    labelNode.set({ x: fitted / 2 }, 0);
  }
  box.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at, duration: 0.35, ease: "outBack" });
  box.set({ scaleX: 0.8, scaleY: 0.8 }, 0);
  return box;
}

export interface ChipOptions {
  label: string;
  x: number;
  y: number;
  at?: number;
  color?: string;
  size?: number;
  dot?: boolean;
  name?: string;
}

/** Uppercase label with an accent dot, no background. */
export function chip(parent: GroupNode, opts: ChipOptions): GroupNode {
  const at = opts.at ?? 0;
  const size = opts.size ?? 10;
  const color = opts.color ?? palette.cyan;
  const width = Math.ceil(opts.label.length * size * 0.68 + 16);
  const box = parent.add(
    group({ name: opts.name ?? "chip", x: opts.x, y: opts.y, width, height: size * 1.6, opacity: 0 }),
  );
  if (opts.dot !== false) {
    box.add(circle({ name: "dot", radius: 3, x: 3, y: size * 0.62, fill: color }));
  }
  box.add(
    text({
      name: "label",
      text: opts.label,
      x: 14,
      y: 0,
      fontSize: size,
      fontFamily: fonts.mono,
      fontWeight: 700,
      color,
    }),
  );
  box.to({ opacity: 1 }, { at, duration: 0.35, ease: "outCubic" });
  return box;
}

export interface ProgressBarOptions {
  x: number;
  y: number;
  width: number;
  height?: number;
  at?: number;
  duration?: number;
  progress?: number;
  color?: string;
  track?: string;
  name?: string;
}

export function progressBar(
  parent: GroupNode,
  opts: ProgressBarOptions,
): { track: RectNode; fill: RectNode } {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.9;
  const height = opts.height ?? 6;
  const track = parent.add(
    rect({
      name: `${opts.name ?? "progress"}-track`,
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height,
      radius: height / 2,
      fill: opts.track ?? palette.borderSoft,
    }),
  );
  const fill = parent.add(
    rect({
      name: `${opts.name ?? "progress"}-fill`,
      x: opts.x,
      y: opts.y,
      width: 0,
      height,
      radius: height / 2,
      fill: opts.color ?? palette.cyan,
      anchorX: 0,
    }),
  );
  fill.to(
    { width: opts.width * (opts.progress ?? 1) },
    { at, duration, ease: "outCubic" },
  );
  return { track, fill };
}

export interface CalloutOptions {
  x: number;
  y: number;
  tx: number;
  ty: number;
  label: string;
  at?: number;
  color?: string;
  size?: number;
  name?: string;
}

/** Leader line from a subject point to a label. */
export function callout(parent: GroupNode, opts: CalloutOptions): GroupNode {
  const at = opts.at ?? 0;
  const color = opts.color ?? palette.emerald;
  const dx = opts.tx - opts.x;
  const dy = opts.ty - opts.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  const box = parent.add(group({ name: opts.name ?? "callout", opacity: 0 }));
  box.add(circle({ name: "anchor", radius: 4, x: opts.x - 4, y: opts.y - 4, fill: color }));
  box.add(
    rect({
      name: "leader",
      x: opts.x,
      y: opts.y - 1,
      width: length,
      height: 2,
      fill: color,
      opacity: 0.8,
      anchorX: 0,
      rotation: angle,
    }),
  );
  box.add(
    text({
      name: "label",
      text: opts.label,
      x: opts.tx + 6,
      y: opts.ty - (opts.size ?? 11) * 0.8,
      fontSize: opts.size ?? 11,
      fontFamily: fonts.mono,
      fontWeight: 700,
      color,
    }),
  );
  box.to({ opacity: 1 }, { at, duration: 0.3, ease: "outCubic" });
  return box;
}

/** Four corner ticks around a rectangle (viewfinder / crop marks). */
export function frameBrackets(
  parent: GroupNode,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    size?: number;
    thickness?: number;
    at?: number;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const color = opts.color ?? palette.cyan;
  const size = opts.size ?? 16;
  const t = opts.thickness ?? 2;
  const box = parent.add(group({ name: opts.name ?? "brackets", opacity: 0 }));
  const corners: Array<[number, number, number, number]> = [
    [opts.x, opts.y, 1, 1],
    [opts.x + opts.width, opts.y, -1, 1],
    [opts.x, opts.y + opts.height, 1, -1],
    [opts.x + opts.width, opts.y + opts.height, -1, -1],
  ];
  corners.forEach(([cx, cy, sx, sy], i) => {
    box.add(
      rect({
        name: `h${i}`,
        x: sx > 0 ? cx : cx - size,
        y: sy > 0 ? cy : cy - t,
        width: size,
        height: t,
        fill: color,
      }),
    );
    box.add(
      rect({
        name: `v${i}`,
        x: sx > 0 ? cx : cx - t,
        y: sy > 0 ? cy : cy - size,
        width: t,
        height: size,
        fill: color,
      }),
    );
  });
  box.to({ opacity: 1 }, { at, duration: 0.35, ease: "outCubic" });
  return box;
}
