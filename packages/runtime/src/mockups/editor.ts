import { rect, RectNode, text, TextNode } from "../graph/kinds";
import { WindowNode, type WindowInit } from "./window";

export interface EditorInit extends WindowInit {
  filename?: string;
  code?: string;
  language?: string;
}

interface HighlightSpan {
  line: number;
  start: number;
  end: number;
}

interface CodeTypeAction {
  code: string;
  at: number;
  duration: number;
}

export class EditorNode extends WindowNode {
  readonly tabTitle: TextNode;
  readonly tabRect: RectNode;
  readonly gutter: RectNode;
  readonly gutterText: TextNode;
  readonly codeNode: TextNode;
  readonly highlightRects: Map<number, RectNode> = new Map();
  private readonly highlights: HighlightSpan[] = [];
  private readonly typeActions: CodeTypeAction[] = [];
  initialCode: string;

  constructor(init: EditorInit = {}) {
    const { filename = "index.ts", code = "", width = 900, height = 600, ...rest } = init;
    super({ ...rest, title: `Visual Studio Code — ${filename}`, width, height, theme: "dark" });

    this.initialCode = code;
    const ed = this;

    // 1. Editor Tab
    this.tabRect = this.add(
      rect({
        name: "tabRect",
        x: 80,
        y: 6,
        width: 160,
        height: 32,
        radius: 4,
        fill: "#1e1e1e",
      }),
    );

    this.tabTitle = this.add(
      text({
        name: "tabTitle",
        text: filename,
        x: 104,
        y: 14,
        fontSize: 12,
        fontFamily: "SF Pro Text, -apple-system, sans-serif",
        color: "#ffffff",
      }),
    );

    // 2. Line numbers gutter background
    this.gutter = this.contentArea.add(
      rect({
        name: "gutter",
        width: 48,
        height: Math.max(0, height - 38),
        fill: "#181818",
      }),
    );

    class DynamicGutterTextNode extends TextNode {
      override propsAt(t: number) {
        const p = super.propsAt(t);
        const codeLines = ed.codeAt(t).split("\n").length;
        p.text = Array.from({ length: Math.max(1, codeLines) }, (_, i) => String(i + 1)).join("\n");
        return p;
      }
    }

    this.gutterText = this.contentArea.add(
      new DynamicGutterTextNode({
        name: "gutterText",
        x: 36,
        y: 12,
        anchorX: 1,
        fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.5,
        color: "#6e7681",
      }),
    );

    // 3. Code content display
    class DynamicCodeTextNode extends TextNode {
      override propsAt(t: number) {
        const p = super.propsAt(t);
        p.text = ed.codeAt(t);
        return p;
      }
    }

    this.codeNode = this.contentArea.add(
      new DynamicCodeTextNode({
        name: "codeText",
        x: 60,
        y: 12,
        text: code,
        fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.5,
        color: "#e6edf3",
      }),
    );
  }

  typeCode(code: string, opts: { at: number; duration: number }): this {
    this.typeActions.push({
      code,
      at: opts.at,
      duration: Math.max(0.01, opts.duration),
    });
    this.typeActions.sort((a, b) => a.at - b.at);
    return this;
  }

  codeAt(t: number): string {
    let current = this.initialCode;
    for (const a of this.typeActions) {
      if (a.at > t) break;
      const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
      const chars = Math.floor(progress * a.code.length);
      current = a.code.slice(0, chars);
    }
    return current;
  }

  highlightLine(line: number, opts: { at: number; duration?: number }): this {
    const duration = opts.duration ?? Infinity;
    this.highlights.push({
      line,
      start: opts.at,
      end: opts.at + duration,
    });
    return this;
  }

  isLineHighlighted(line: number, t: number): boolean {
    return this.highlights.some((h) => h.line === line && t >= h.start && t <= h.end);
  }
}

export const editor = (init?: EditorInit) => new EditorNode(init);
