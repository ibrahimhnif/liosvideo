import { vo, type WordTiming } from "../audio/timing";
import { GroupNode, measureText, RectNode, TextNode } from "../graph/kinds";
import type { Node } from "../graph/node";
import { layout } from "../layout";

/** A VO line id (played after the previous line), a line at an explicit time, or raw words. */
export type CaptionLine = string | { id: string; at?: number } | { words: WordTiming[]; at?: number; id?: string };

export interface CaptionOptions {
  /** VO lines in the order they are spoken; times are seconds from the scene start. */
  lines: CaptionLine[];
  /** When the first line starts (default 0). */
  start?: number;
  /** Silence between back-to-back string ids (default 0.3 s). */
  gap?: number;
  /** "short" (9:16) or "long" (16:9); defaults from the frame's orientation. */
  preset?: "short" | "long";
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  /** Colour of the word being spoken. */
  activeColor?: string;
  /** Fill of a rounded pill behind each chunk (e.g. "#000000aa"); off by default. */
  background?: string;
  /** Most words in one chunk (default 6 short, 9 long). */
  maxWords?: number;
  /** Seconds a chunk stays up after its last word (default 0.35). */
  hold?: number;
  name?: string;
}

const PRESETS = {
  short: { fontWeight: 800, maxWords: 6 },
  long: { fontWeight: 700, maxWords: 9 },
} as const;

const ACTIVE_SCALE = 1.06;

type Chunk = { lines: { text: string; start: number; end: number; width: number }[][]; start: number; end: number };

/**
 * Karaoke captions from VO word timings, placed in `layout().slot("caption")` (above the platform UI
 * in 9:16). Chunks break at sentence punctuation, at the measured line width and after two lines; the
 * spoken word lights up. Returns the caption layer (one child group per chunk).
 */
export function captions(root: Node<any>, opts: CaptionOptions): GroupNode {
  const { width, height } = root.propsAt(0);
  if (!(width > 0 && height > 0)) throw new Error("captions(): add them to the scene root (it needs a width and height)");
  const L = layout({ width, height });
  const preset = PRESETS[opts.preset ?? (L.orientation === "portrait" ? "short" : "long")];
  const slot = L.slot("caption");
  const pad = opts.background ? L.gap(2) : 0;
  const lineHeight = 1.25;
  const fontFamily = opts.fontFamily ?? "SF Pro Text";
  const fontWeight = opts.fontWeight ?? preset.fontWeight;
  const color = opts.color ?? "#ffffff";
  const activeColor = opts.activeColor ?? "#ffd60a";
  const maxWords = opts.maxWords ?? preset.maxWords;
  const hold = opts.hold ?? 0.35;
  // room for the active word's scale-up at either end of a line
  const maxLine = (slot.width - pad * 2) / ACTIVE_SCALE;

  const timed = resolveLines(opts);
  let fontSize = opts.fontSize ?? L.type.h2.fontSize;
  const measure = (text: string, size = fontSize) => measureText({ text, fontSize: size, fontFamily, fontWeight, lineHeight }).width;
  // one very long word (Indonesian has plenty) shrinks the type rather than leaving the frame
  const widest = Math.max(0, ...timed.flatMap((l) => l.words.map((w) => measure(w.word.trim()))));
  if (widest > maxLine) fontSize *= maxLine / widest;
  const space = Math.max(measure("a a") - measure("aa"), fontSize * 0.25);

  const chunks: Chunk[] = [];
  for (const line of timed) {
    let chunk: Chunk | null = null;
    let count = 0;
    const flush = () => {
      if (chunk && count) chunks.push(chunk);
      chunk = null;
      count = 0;
    };
    for (const w of line.words) {
      const text = w.word.trim();
      if (!text) continue;
      const word = { text, start: line.at + w.start, end: line.at + w.end, width: measure(text) };
      if (!chunk) chunk = { lines: [[]], start: word.start, end: word.end };
      const c: Chunk = chunk;
      const row = c.lines[c.lines.length - 1];
      const rowWidth = row.reduce((s, x) => s + x.width, 0) + space * row.length;
      if (row.length && rowWidth + word.width > maxLine) {
        if (c.lines.length === 2) {
          flush();
          chunk = { lines: [[word]], start: word.start, end: word.end };
          count = 1;
          continue;
        }
        c.lines.push([word]);
      } else row.push(word);
      c.end = word.end;
      count++;
      if (/[.?!…]["')\]]?$/.test(text) || (/[,;:]$/.test(text) && count >= 3) || count >= maxWords) flush();
    }
    flush();
  }
  chunks.sort((a, b) => a.start - b.start);

  const name = (opts.name ?? "captions").replaceAll("/", "-");
  const layer = root.add(new GroupNode({ name }));
  const rowH = fontSize * lineHeight;
  chunks.forEach((chunk, i) => {
    const show = Math.max(0, chunk.start - 0.04);
    const next = chunks[i + 1];
    const hide = Math.min(chunk.end + hold, next ? next.start - 0.04 : Infinity);
    const g = layer.add(new GroupNode({ name: `chunk${i}`, opacity: 0 }));
    g.set({ opacity: 1 }, show).set({ opacity: 0 }, hide);

    // bottom-aligned in the slot, so a second line grows upward
    const blockH = chunk.lines.length * rowH;
    const top = slot.y + slot.height - blockH - pad / 2;
    const cx = slot.x + slot.width / 2;
    const rowWidths = chunk.lines.map((r) => r.reduce((s, x) => s + x.width, 0) + space * (r.length - 1));
    if (opts.background) {
      const w = Math.max(...rowWidths) * ACTIVE_SCALE + pad * 2;
      g.add(new RectNode({ name: "pill", x: cx - w / 2, y: top - pad / 2, width: w, height: blockH + pad, radius: pad, fill: opts.background }));
    }
    chunk.lines.forEach((row, r) => {
      let x = cx - rowWidths[r] / 2;
      for (const word of row) {
        const t = g.add(
          new TextNode({
            name: `w${g.children.length}`,
            text: word.text,
            fontFamily,
            fontSize,
            fontWeight,
            lineHeight,
            color,
            x: x + word.width / 2,
            y: top + r * rowH + rowH / 2,
            width: word.width,
            height: rowH,
            anchorX: 0.5,
            anchorY: 0.5,
          }),
        );
        // grow at most half a space per side, so a long word never runs into its neighbours
        const grow = Math.min(ACTIVE_SCALE, 1 + (space * 0.9) / Math.max(word.width, 1));
        t.set({ color: activeColor }, word.start).set({ color }, word.end);
        t.to({ scaleX: grow, scaleY: grow }, { at: word.start, duration: 0.08, ease: "outCubic" });
        t.to({ scaleX: 1, scaleY: 1 }, { at: word.end, duration: 0.12, ease: "outCubic" });
        x += word.width + space;
      }
    });
  });
  return layer;
}

function resolveLines(opts: CaptionOptions): { at: number; words: WordTiming[] }[] {
  let cursor = opts.start ?? 0;
  const gap = opts.gap ?? 0.3;
  return opts.lines.map((line) => {
    let words: WordTiming[];
    let duration: number;
    let at: number | undefined;
    if (typeof line !== "string" && "words" in line) {
      words = line.words;
      duration = Math.max(0, ...words.map((w) => w.end));
      at = line.at;
    } else {
      const id = typeof line === "string" ? line : line.id;
      at = typeof line === "string" ? undefined : line.at;
      const v = vo(id);
      if (!v.words.length) {
        throw new Error(`captions(): no word timing for VO line "${id}". Generate it with tts_generate (or record it in the app) first.`);
      }
      words = v.words;
      duration = v.duration || Math.max(...words.map((w) => w.end));
    }
    const start = at ?? cursor;
    cursor = start + duration + gap;
    return { at: start, words };
  });
}
