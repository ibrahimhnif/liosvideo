/**
 * Data-viz components: animated bar charts and a fake audio waveform.
 * Both are pure geometry, so they render identically in preview and CLI.
 */

import { group, rect, seededRandom, text, type GroupNode } from "liosvideo";
import { fonts, palette } from "./theme";

export interface BarDatum {
  label: string;
  value: number;
}

/** Animated bar chart with labels and value readouts. */
export function barChart(
  parent: GroupNode,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    values: BarDatum[];
    at?: number;
    duration?: number;
    color?: string;
    highlightColor?: string;
    max?: number;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const duration = opts.duration ?? 0.55;
  const color = opts.color ?? palette.border;
  const highlight = opts.highlightColor ?? palette.cyan;
  const max = opts.max ?? Math.max(...opts.values.map((v) => v.value), 1);
  const step = opts.width / Math.max(1, opts.values.length);
  const barW = step * 0.52;

  const box = parent.add(group({ name: opts.name ?? "bar-chart", width: opts.width, height: opts.height }));

  const baseline = box.add(
    rect({ name: "baseline", x: opts.x, y: opts.y + opts.height, width: 0, height: 1, fill: palette.border }),
  );
  baseline.to({ width: opts.width }, { at, duration: 0.4, ease: "outCubic" });

  opts.values.forEach((datum, i) => {
    const h = Math.max(2, (datum.value / max) * opts.height);
    const cx = opts.x + i * step + step / 2;
    const isLast = i === opts.values.length - 1;

    const bar = box.add(
      rect({
        name: `bar-${i}`,
        x: cx - barW / 2,
        y: opts.y + opts.height,
        width: barW,
        height: 0,
        radius: 4,
        fill: isLast ? highlight : color,
        anchorY: 1,
      }),
    );
    bar.to({ height: h }, { at: at + 0.1 + i * 0.09, duration, ease: "outCubic" });

    box.add(
      text({
        name: `label-${i}`,
        text: datum.label,
        x: cx,
        y: opts.y + opts.height + 14,
        anchorX: 0.5,
        fontFamily: fonts.mono,
        fontSize: 12,
        color: palette.muted,
      }),
    );

    const value = box.add(
      text({
        name: `value-${i}`,
        text: String(Math.round(datum.value)),
        x: cx,
        y: opts.y + opts.height - h - 26,
        anchorX: 0.5,
        fontFamily: fonts.mono,
        fontSize: 14,
        fontWeight: 700,
        color: isLast ? highlight : palette.text,
        opacity: 0,
      }),
    );
    value.to({ opacity: 1 }, { at: at + 0.25 + i * 0.09, duration: 0.25 });
  });

  return box;
}

/** Equalizer bars driven by a seeded pattern. */
export function waveform(
  parent: GroupNode,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    bars?: number;
    at?: number;
    color?: string;
    seed?: number;
    step?: number;
    name?: string;
  },
): GroupNode {
  const at = opts.at ?? 0;
  const bars = opts.bars ?? 28;
  const step = opts.step ?? 0.12;
  const color = opts.color ?? palette.cyan;
  const rand = seededRandom(String(opts.seed ?? 17));
  const slot = opts.width / bars;
  const barW = slot * 0.55;

  const box = parent.add(group({ name: opts.name ?? "waveform", width: opts.width, height: opts.height }));

  for (let i = 0; i < bars; i++) {
    const x = opts.x + i * slot + (slot - barW) / 2;
    const bar = box.add(
      rect({
        name: `wave-${i}`,
        x,
        y: opts.y + opts.height,
        width: barW,
        height: opts.height * 0.2,
        radius: barW / 2,
        fill: color,
        anchorY: 1,
        opacity: 0.9,
      }),
    );
    // deterministic pseudo-spectrum, re-rolled on every beat
    let phase = 0;
    for (let k = 0; k < 8; k++) {
      const t = at + k * step;
      const wave = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.7 + phase));
      bar.set({ height: Math.max(6, wave * opts.height) }, t);
      phase += 1.1 + rand();
    }
  }

  return box;
}
