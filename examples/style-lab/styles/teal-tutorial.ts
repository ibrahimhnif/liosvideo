/**
 * Teal Tutorial — calm dark-teal screens for software how-tos: numbered step cards, a code pane
 * that types itself, and the UI mockups (`browserWindow`, `fileExplorer`, `chatThread`,
 * `notification`) in the same palette.
 *
 * One step per scene: the step card in the title slot, the code on one side and what it does on
 * the other (`layout().slot("left")` / `"right"`, which stack in 9:16). Reveal lines in the order
 * they are explained; highlight the line being talked about with `codePane(...).focus(i, at)`.
 */
import { group, rect, text, type BaseProps, type Ease, type GroupNode, type Node } from "liosvideo";

export const theme = {
  colors: {
    bg: "#061a1d",
    panel: "#0c2a2f",
    panelBorder: "#1b4a50",
    teal: "#2dd4bf",
    ink: "#e6fffb",
    muted: "#7fa8a3",
    keyword: "#5eead4",
    string: "#fcd34d",
    comment: "#5f8784",
    number: "#f9a8d4",
  },
  fonts: { heading: "Avenir Next", body: "Avenir Next", code: "Menlo" },
  ease: { rise: "outCubic" as Ease, snap: "outBack" as Ease },
};

/** Clean screens: no filter. */
export const look: Partial<BaseProps> = {};

type Box = { x: number; y: number; width: number; height: number };

/** Fades a node in while it rises a little. */
export function rise<N extends Node<any>>(node: N, at: number, distance = 16, duration = 0.45): N {
  const y = node.propsAt(0).y;
  node.set({ opacity: 0, y: y + distance }, 0);
  node.to({ opacity: 1, y }, { at, duration, ease: theme.ease.rise });
  return node;
}

/**
 * A step header: a teal number badge, the step title and an optional one-line summary, inside
 * `box` (use `layout().slot("title")`). Fades in at `at`.
 */
export function stepCard(box: Box, o: { step: number; title: string; summary?: string; at: number; size: number }): GroupNode {
  const g = group({ name: "step", x: box.x, y: box.y, width: box.width, height: box.height });
  const badge = o.size * 1.6;
  const b = g.add(group({ name: "badge", width: badge, height: badge }));
  b.add(rect({ name: "background", width: badge, height: badge, radius: badge * 0.28, fill: theme.colors.teal }));
  b.add(text({ name: "numberText", text: String(o.step), width: badge, height: badge, align: "center", fontFamily: theme.fonts.heading, fontWeight: 800, fontSize: o.size * 0.9, lineHeight: badge / (o.size * 0.9), color: theme.colors.bg }));
  const x = badge + o.size * 0.7;
  g.add(text({ name: "titleText", text: o.title, x, y: (badge - o.size * 1.2) / 2 - (o.summary ? o.size * 0.35 : 0), maxWidth: box.width - x, fontFamily: theme.fonts.heading, fontWeight: 700, fontSize: o.size, lineHeight: 1.2, color: theme.colors.ink }));
  if (o.summary) {
    g.add(text({ name: "summaryText", text: o.summary, x, y: (badge - o.size * 1.2) / 2 + o.size * 1.05, maxWidth: box.width - x, fontFamily: theme.fonts.body, fontSize: o.size * 0.55, lineHeight: 1.4, color: theme.colors.muted }));
  }
  rise(g, o.at);
  return g;
}

const KEYWORDS = new Set(["import", "from", "export", "default", "const", "let", "function", "return", "await", "async", "new", "if", "else", "true", "false", "null"]);

/** Splits a line into coloured tokens: comments, strings, numbers, keywords, the rest. */
export function tokens(line: string): { text: string; color: string }[] {
  const c = theme.colors;
  const out: { text: string; color: string }[] = [];
  const re = /(\/\/.*$)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  for (const m of line.matchAll(re)) {
    const [all, comment, str, num, word] = m;
    const color = comment ? c.comment : str ? c.string : num ? c.number : word && KEYWORDS.has(word) ? c.keyword : c.ink;
    const last = out[out.length - 1];
    if (last && last.color === color) last.text += all;
    else out.push({ text: all, color });
  }
  return out;
}

export interface CodePane extends GroupNode {
  /** One group per code line (numbers, tokens) */
  lines: GroupNode[];
  /** Highlights line `index` (0-based) from `at` until the next focus */
  focus(index: number, at: number): CodePane;
}

/**
 * A code editor pane in `box`: a title bar with the file name, line numbers and coloured code.
 * Lines appear one by one from `at`, `stagger` s apart (0 shows them all at `at`).
 */
export function codePane(box: Box, o: { file: string; code: string; at: number; stagger?: number; fontSize: number }): CodePane {
  const c = theme.colors;
  const g = group({ name: "code", x: box.x, y: box.y, width: box.width, height: box.height }) as CodePane;
  const rows = o.code.replace(/\n$/, "").split("\n");
  // shrink the type (to 70% at most) so the longest line fits; past that, lines are clipped
  const longest = Math.max(1, ...rows.map((r) => r.length));
  const fitting = (box.width - o.fontSize * 1.1) / (longest * 0.6 + 2.6);
  const fs = Math.max(o.fontSize * 0.7, Math.min(o.fontSize, fitting));
  const bar = fs * 2.4;
  const pad = fs * 1.1;
  const lineH = fs * 1.55;
  g.add(rect({ name: "panel", width: box.width, height: box.height, radius: fs * 0.7, fill: c.panel, stroke: c.panelBorder, strokeWidth: Math.max(1, fs * 0.06) }));
  g.add(rect({ name: "bar", width: box.width, height: bar, radius: fs * 0.7, fill: c.panelBorder }));
  ["#ff5f57", "#febc2e", "#28c840"].forEach((fill, i) => g.add(rect({ name: `light${i}`, x: pad + i * fs * 1.0, y: bar / 2 - fs * 0.3, width: fs * 0.6, height: fs * 0.6, radius: fs * 0.3, fill })));
  g.add(text({ name: "fileText", text: o.file, x: pad + fs * 3.4, y: (bar - fs * 0.8 * 1.2) / 2, fontFamily: theme.fonts.body, fontSize: fs * 0.8, color: c.muted }));
  const highlight = g.add(rect({ name: "highlight", x: fs * 0.3, y: bar + pad, width: box.width - fs * 0.6, height: lineH, radius: fs * 0.25, fill: c.teal, opacity: 0 }));
  const gutter = fs * 2.6;
  const charW = fs * 0.6; // monospace advance
  const fits = Math.max(1, Math.floor((box.height - bar - pad * 2) / lineH));
  g.lines = rows.slice(0, fits).map((row, i) => {
    const line = g.add(group({ name: `line${i}`, y: bar + pad + i * lineH, width: box.width, height: lineH }));
    line.add(text({ name: "numberText", text: String(i + 1), x: fs * 0.4, width: gutter - fs, align: "right", y: (lineH - fs * 1.2) / 2, fontFamily: theme.fonts.code, fontSize: fs, color: c.comment }));
    let col = 0;
    const maxCols = Math.floor((box.width - gutter - pad) / charW);
    tokens(row).forEach((t, k) => {
      if (col >= maxCols) return;
      const shown = t.text.slice(0, maxCols - col);
      if (shown.trim()) {
        line.add(text({ name: `token${k}`, text: shown, x: gutter + col * charW, y: (lineH - fs * 1.2) / 2, fontFamily: theme.fonts.code, fontSize: fs, color: t.color }));
      }
      col += shown.length;
    });
    line.set({ opacity: 0 }, 0);
    line.to({ opacity: 1 }, { at: o.at + i * (o.stagger ?? 0.18), duration: 0.2, ease: "linear" });
    return line;
  });
  g.focus = (index: number, at: number) => {
    const target = g.lines[Math.max(0, Math.min(index, g.lines.length - 1))];
    highlight.set({ opacity: 0.16 }, at);
    highlight.to({ y: target.propsAt(0).y }, { at, duration: 0.25, ease: "outCubic" });
    return g;
  };
  return g;
}

/** A small teal pill, e.g. "Terminal", "Result", "Tip". */
export function tag(label: string, o: { x: number; y: number; size: number; at: number }): GroupNode {
  const w = label.length * o.size * 0.62 + o.size * 1.4;
  const h = o.size * 1.8;
  const g = group({ name: "tag", x: o.x, y: o.y, width: w, height: h });
  g.add(rect({ name: "background", width: w, height: h, radius: h / 2, fill: theme.colors.teal, opacity: 0.18 }));
  g.add(text({ name: "labelText", text: label, width: w, align: "center", y: (h - o.size * 1.2) / 2, fontFamily: theme.fonts.body, fontWeight: 700, fontSize: o.size, color: theme.colors.teal }));
  return rise(g, o.at, 8);
}
