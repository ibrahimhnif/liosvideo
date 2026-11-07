// Shared pieces of the UI mockups (browserWindow, fileExplorer, chatThread, notification):
// light/dark palettes, a size unit, and text that is wrapped and measured up front so the
// components can stack it.
import { measureText } from "../graph/kinds";

export type UiTheme = "dark" | "light";

export const UI_FONT = "SF Pro Text";
export const UI_MONO = "SF Mono";

export interface Palette {
  window: string;
  chrome: string;
  chromeBorder: string;
  tab: string;
  tabActive: string;
  field: string;
  text: string;
  muted: string;
  accent: string;
  selection: string;
  bubbleUser: string;
  bubbleUserText: string;
  bubbleOther: string;
  bubbleOtherText: string;
  card: string;
  cardBorder: string;
  shadow: string;
}

export function palette(theme: UiTheme = "dark"): Palette {
  return theme === "light"
    ? {
        window: "#ffffff",
        chrome: "#eef0f3",
        chromeBorder: "#d5d8de",
        tab: "#e2e5ea",
        tabActive: "#ffffff",
        field: "#ffffff",
        text: "#1d2129",
        muted: "#6b7280",
        accent: "#2563eb",
        selection: "#dbe7ff",
        bubbleUser: "#2563eb",
        bubbleUserText: "#ffffff",
        bubbleOther: "#eef0f3",
        bubbleOtherText: "#1d2129",
        card: "#ffffffee",
        cardBorder: "#d5d8de",
        shadow: "#0000001f",
      }
    : {
        window: "#16181d",
        chrome: "#22252b",
        chromeBorder: "#30343c",
        tab: "#1b1e23",
        tabActive: "#2c3038",
        field: "#121418",
        text: "#e8eaed",
        muted: "#9aa0a6",
        accent: "#60a5fa",
        selection: "#2a3b57",
        bubbleUser: "#2563eb",
        bubbleUserText: "#ffffff",
        bubbleOther: "#2a2d34",
        bubbleOtherText: "#e8eaed",
        card: "#2a2d34f2",
        cardBorder: "#3a3e46",
        shadow: "#00000066",
      };
}

/** Size unit for a component box: 1 at about 1000 px wide, so its parts scale with the box. */
export function unit(width: number, height: number): number {
  return Math.max(0.45, Math.min(width / 1000, height / 640, 2.4));
}

export interface WrappedText {
  text: string;
  width: number;
  height: number;
  lines: number;
}

/**
 * Word-wraps `text` to `maxWidth` with the installed text measurer (an estimate in tests), so the
 * node can be given its final size. Long words are cut into pieces that fit.
 */
export function wrapText(
  text: string,
  opts: { fontSize: number; maxWidth: number; fontWeight?: number; lineHeight?: number; fontFamily?: string },
): WrappedText {
  const style = { fontSize: opts.fontSize, fontWeight: opts.fontWeight ?? 400, lineHeight: opts.lineHeight ?? 1.3, fontFamily: opts.fontFamily ?? UI_FONT };
  const widthOf = (s: string) => measureText({ ...style, text: s }).width;
  const maxWidth = Math.max(opts.fontSize, opts.maxWidth);
  const out: string[] = [];
  for (const hard of text.split("\n")) {
    let line = "";
    for (let word of hard.split(" ").filter((w) => w !== "")) {
      while (widthOf(word) > maxWidth && word.length > 1) {
        // a word wider than the box: cut it
        let n = word.length - 1;
        while (n > 1 && widthOf(word.slice(0, n)) > maxWidth) n--;
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(word.slice(0, n));
        word = word.slice(n);
      }
      const next = line ? `${line} ${word}` : word;
      if (line && widthOf(next) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  const wrapped = out.join("\n");
  const width = Math.min(maxWidth, Math.max(0, ...out.map(widthOf)));
  return { text: wrapped, width, height: out.length * opts.fontSize * style.lineHeight, lines: out.length };
}

/** Cuts `text` to fit `maxWidth` on one line, with an ellipsis. */
export function ellipsize(text: string, opts: { fontSize: number; maxWidth: number; fontWeight?: number; fontFamily?: string }): string {
  const style = { fontSize: opts.fontSize, fontWeight: opts.fontWeight ?? 400, fontFamily: opts.fontFamily ?? UI_FONT };
  const fits = (s: string) => measureText({ ...style, text: s }).width <= opts.maxWidth;
  if (fits(text)) return text;
  let n = text.length;
  while (n > 0 && !fits(`${text.slice(0, n)}…`)) n--;
  return n > 0 ? `${text.slice(0, n)}…` : "";
}

/** Width of one line of text. */
export function textWidth(text: string, opts: { fontSize: number; fontWeight?: number; fontFamily?: string }): number {
  return measureText({ fontSize: opts.fontSize, fontWeight: opts.fontWeight ?? 400, fontFamily: opts.fontFamily ?? UI_FONT, text }).width;
}
