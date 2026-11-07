// fileExplorer(): a file tree (folders open or closed) with an animated selection.
import { group, GroupNode, rect, RectNode, TextNode } from "../graph/kinds";
import type { BaseProps, NodeInit } from "../graph/node";
import type { Ease } from "../anim/easing";
import { ellipsize, palette, UI_FONT, unit, type UiTheme } from "./ui_kit";

export type ExplorerItem = string | { name: string; children?: ExplorerItem[]; open?: boolean; folder?: boolean };

export interface FileExplorerInit extends NodeInit<BaseProps> {
  items: ExplorerItem[];
  /** Name of the row selected at the start */
  selected?: string;
  /** Header text, e.g. the project name */
  title?: string;
  theme?: UiTheme;
}

export interface ExplorerRow {
  name: string;
  depth: number;
  folder: boolean;
  group: GroupNode;
  label: TextNode;
}

const FOLDER = "#e8a33d";
const FILE_COLORS: Record<string, string> = { ts: "#3178c6", js: "#f1c232", json: "#cbcb41", md: "#7d8590", png: "#a074c4", jpg: "#a074c4", mp4: "#e05d44", mp3: "#3fb950", rs: "#dea584", css: "#563d7c", html: "#e34c26" };

function flatten(items: ExplorerItem[], depth: number, out: { name: string; depth: number; folder: boolean; open: boolean }[]) {
  for (const item of items) {
    if (typeof item === "string") {
      out.push({ name: item, depth, folder: false, open: false });
      continue;
    }
    const folder = item.folder ?? item.children !== undefined;
    const open = folder && item.open !== false;
    out.push({ name: item.name, depth, folder, open });
    if (open && item.children) flatten(item.children, depth + 1, out);
  }
  return out;
}

export class FileExplorerNode extends GroupNode {
  readonly panel: RectNode;
  readonly rows: ExplorerRow[];
  /** The selection bar; `select()` moves it */
  readonly highlight: RectNode;

  constructor(init: FileExplorerInit) {
    const { items, selected, title = "EXPLORER", theme = "dark", width = 360, height = 560, name = "explorer", ...rest } = init;
    super({ ...rest, name, width, height });
    const c = palette(theme);
    const k = unit(width * 2.2, height);
    const font = 14 * k;
    const rowH = 28 * k;
    const pad = 12 * k;
    const indent = 16 * k;
    const headerH = 36 * k;

    this.panel = this.add(rect({ name: "panel", width, height, radius: 10 * k, fill: c.chrome, stroke: c.chromeBorder, strokeWidth: Math.max(1, k) }));
    this.add(
      new TextNode({
        name: "headerText",
        text: ellipsize(title, { fontSize: 11 * k, maxWidth: width - 2 * pad, fontWeight: 600 }),
        x: pad,
        y: (headerH - 11 * k * 1.2) / 2,
        width: width - 2 * pad,
        height: 11 * k * 1.2,
        fontSize: 11 * k,
        fontWeight: 600,
        fontFamily: UI_FONT,
        color: c.muted,
      }),
    );
    const list = this.add(group({ name: "list", y: headerH, width, height: Math.max(0, height - headerH - 6 * k), clip: true }));
    const flat = flatten(items, 0, []);
    const first = flat.findIndex((r) => r.name === selected);
    this.highlight = list.add(rect({ name: "highlight", x: 4 * k, y: Math.max(0, first) * rowH, width: width - 8 * k, height: rowH, radius: 6 * k, fill: c.selection, opacity: first >= 0 ? 1 : 0 }));

    this.rows = flat.map((r, i) => {
      const x = pad + r.depth * indent;
      const g = list.add(group({ name: `row${i}`, x, y: i * rowH, width: Math.max(0, width - x - 4 * k), height: rowH }));
      const iconW = 12 * k;
      const ext = r.name.includes(".") ? r.name.split(".").pop()!.toLowerCase() : "";
      if (r.folder) {
        g.add(new TextNode({ name: "chevronText", text: r.open ? "▾" : "▸", y: (rowH - font * 1.2) / 2, width: 10 * k, height: font * 1.2, fontSize: font, fontFamily: UI_FONT, color: c.muted }));
        g.add(rect({ name: "icon", x: 12 * k, y: (rowH - 10 * k) / 2, width: iconW + 2 * k, height: 10 * k, radius: 2 * k, fill: FOLDER }));
      } else {
        g.add(rect({ name: "icon", x: 12 * k, y: (rowH - 13 * k) / 2, width: 10 * k, height: 13 * k, radius: 2 * k, fill: FILE_COLORS[ext] ?? c.muted }));
      }
      const labelX = 32 * k;
      const maxW = Math.max(0, width - x - labelX - 8 * k);
      const label = g.add(
        new TextNode({
          name: "labelText",
          text: ellipsize(r.name, { fontSize: font, maxWidth: maxW }),
          x: labelX,
          y: (rowH - font * 1.2) / 2,
          width: maxW,
          height: font * 1.2,
          fontSize: font,
          fontFamily: UI_FONT,
          color: c.text,
        }),
      );
      return { name: r.name, depth: r.depth, folder: r.folder, group: g, label };
    });
  }

  /** The row called `name` (exact, then case-insensitive). */
  row(name: string): ExplorerRow {
    const found = this.rows.find((r) => r.name === name) ?? this.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(`fileExplorer: no row "${name}" (rows: ${this.rows.map((r) => r.name).join(", ")})`);
    return found;
  }

  /** Moves the selection to the row called `name`. */
  select(name: string, opts: { at: number; duration?: number; ease?: Ease }): this {
    const target = this.row(name);
    const y = target.group.propsAt(0).y;
    this.highlight.set({ opacity: 1 }, opts.at);
    this.highlight.to({ y }, { at: opts.at, duration: Math.max(0.01, opts.duration ?? 0.25), ease: opts.ease ?? "outCubic" });
    return this;
  }
}

export const fileExplorer = (init: FileExplorerInit) => new FileExplorerNode(init);
