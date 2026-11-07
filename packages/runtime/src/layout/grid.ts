import type { TextAlign } from "../graph/kinds";

export type Box = { x: number; y: number; width: number; height: number };

/** A named region of the frame with the text alignment that suits it. */
export type Slot = Box & { align: TextAlign };

export type Orientation = "landscape" | "portrait" | "square";

export type SlotName = "full" | "title" | "center" | "body" | "left" | "right" | "lowerThird" | "caption";

export type Gap = 1 | 2 | 3 | 4 | 6 | 8;

export type TypeStyle = { fontSize: number; lineHeight: number; fontWeight: number };

export type TypeScale = Record<"display" | "h1" | "h2" | "body" | "caption" | "label", TypeStyle>;

export interface Layout {
  width: number;
  height: number;
  orientation: Orientation;
  /** Rhythm unit: min(width, height) / 100. */
  u: number;
  /** Content area: u*6 from every edge; 9:16 also keeps the top 5% and bottom 12% clear. */
  safe: Box;
  columns: number;
  rows: number;
  /** Space between columns and between rows (u * 2). */
  gutter: number;
  /** Columns `start`..`start+span-1`, 1-based. */
  col(start: number, span?: number): { x: number; width: number };
  /** Rows `start`..`start+span-1`, 1-based. */
  row(start: number, span?: number): { y: number; height: number };
  cell(colStart: number, colSpan: number, rowStart: number, rowSpan: number): Box;
  /** u * n; only the spacing scale 1, 2, 3, 4, 6, 8 is allowed. */
  gap(n: Gap): number;
  slot(name: SlotName): Slot;
  readonly slotNames: readonly SlotName[];
  type: TypeScale;
}

const GAPS: readonly number[] = [1, 2, 3, 4, 6, 8];

const GRID: Record<Orientation, { columns: number; rows: number }> = {
  landscape: { columns: 12, rows: 6 },
  portrait: { columns: 4, rows: 12 },
  square: { columns: 8, rows: 8 },
};

/** Slot table per orientation: [colStart, colSpan, rowStart, rowSpan, align]. */
type SlotDef = [number, number, number, number, TextAlign];
const SLOTS: Record<Orientation, Record<SlotName, SlotDef>> = {
  landscape: {
    full: [1, 12, 1, 6, "center"],
    title: [1, 10, 1, 2, "left"],
    center: [2, 10, 2, 4, "center"],
    body: [1, 12, 3, 4, "left"],
    left: [1, 6, 1, 6, "left"],
    right: [7, 6, 1, 6, "left"],
    lowerThird: [1, 7, 5, 2, "left"],
    caption: [2, 10, 6, 1, "center"],
  },
  portrait: {
    full: [1, 4, 1, 12, "center"],
    title: [1, 4, 1, 3, "left"],
    center: [1, 4, 4, 6, "center"],
    body: [1, 4, 4, 9, "left"],
    left: [1, 4, 1, 6, "left"],
    right: [1, 4, 7, 6, "left"],
    lowerThird: [1, 4, 10, 3, "left"],
    caption: [1, 4, 11, 2, "center"],
  },
  square: {
    full: [1, 8, 1, 8, "center"],
    title: [1, 7, 1, 2, "left"],
    center: [1, 8, 3, 4, "center"],
    body: [1, 8, 3, 6, "left"],
    left: [1, 4, 1, 8, "left"],
    right: [5, 4, 1, 8, "left"],
    lowerThird: [1, 6, 7, 2, "left"],
    caption: [1, 8, 8, 1, "center"],
  },
};

function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.87) return "portrait";
  return "square";
}

/**
 * The layout grid for a frame size: safe area, columns/rows, spacing scale, named slots and a type scale.
 * Pass the scene's `{ width, height }`; the same calls give a correct layout in 16:9, 9:16 and 1:1.
 */
export function layout({ width, height }: { width: number; height: number }): Layout {
  const orientation = orientationOf(width, height);
  const u = Math.min(width, height) / 100;
  const edge = u * 6;
  const top = orientation === "portrait" ? Math.max(edge, height * 0.05) : edge;
  const bottom = orientation === "portrait" ? Math.max(edge, height * 0.12) : edge;
  const safe: Box = { x: edge, y: top, width: width - edge * 2, height: height - top - bottom };
  const { columns, rows } = GRID[orientation];
  const gutter = u * 2;
  const colW = (safe.width - gutter * (columns - 1)) / columns;
  const rowH = (safe.height - gutter * (rows - 1)) / rows;

  const check = (what: "columns" | "rows", count: number, start: number, span: number) => {
    if (!Number.isInteger(start) || !Number.isInteger(span) || start < 1 || span < 1 || start + span - 1 > count) {
      throw new Error(`${what} ${start}–${start + span - 1} do not fit the ${count}-${what.slice(0, -1)} ${orientation} grid`);
    }
  };
  const col = (start: number, span = 1) => {
    check("columns", columns, start, span);
    return { x: safe.x + (start - 1) * (colW + gutter), width: span * colW + (span - 1) * gutter };
  };
  const row = (start: number, span = 1) => {
    check("rows", rows, start, span);
    return { y: safe.y + (start - 1) * (rowH + gutter), height: span * rowH + (span - 1) * gutter };
  };
  const cell = (colStart: number, colSpan: number, rowStart: number, rowSpan: number): Box => {
    const c = col(colStart, colSpan);
    const r = row(rowStart, rowSpan);
    return { x: c.x, y: r.y, width: c.width, height: r.height };
  };
  const gap = (n: Gap) => {
    if (!GAPS.includes(n)) throw new Error(`gap(${n}): use one of 1, 2, 3, 4, 6, 8`);
    return u * n;
  };
  const slots = SLOTS[orientation];
  const slot = (name: SlotName): Slot => {
    const def = slots[name];
    if (!def) throw new Error(`Unknown slot "${name}". Slots: ${Object.keys(slots).join(", ")}`);
    const [c, cs, r, rs, align] = def;
    return { ...cell(c, cs, r, rs), align };
  };
  // Portrait frames are watched on phones at the same pixel width, so type runs larger relative to u.
  const t = orientation === "portrait" ? 1.25 : 1;
  const style = (size: number, lineHeight: number, fontWeight: number): TypeStyle => ({
    fontSize: Math.round(u * size * t * 10) / 10,
    lineHeight,
    fontWeight,
  });
  const type: TypeScale = {
    display: style(9, 1.1, 800),
    h1: style(6.5, 1.15, 700),
    h2: style(4.5, 1.2, 700),
    body: style(3.2, 1.45, 400),
    caption: style(2.6, 1.4, 500),
    label: style(2, 1.3, 600),
  };

  return {
    width, height, orientation, u, safe, columns, rows, gutter,
    col, row, cell, gap, slot, slotNames: Object.keys(slots) as SlotName[], type,
  };
}
