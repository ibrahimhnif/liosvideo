import { text, TextNode } from "../graph/kinds";
import { type NodeInit } from "../graph/node";
import { WindowNode, type WindowInit } from "./window";

export interface TerminalInit extends WindowInit {
  cwd?: string;
  user?: string;
  host?: string;
}

interface TypeAction {
  kind: "type";
  prompt: string;
  command: string;
  at: number;
  duration: number;
}

interface LineAction {
  kind: "line";
  text: string;
  at: number;
}

interface ClearAction {
  kind: "clear";
  at: number;
}

type TerminalAction = TypeAction | LineAction | ClearAction;

export class TerminalNode extends WindowNode {
  readonly prompt: string;
  private readonly actions: TerminalAction[] = [];
  readonly bufferNode: TextNode;

  constructor(init: TerminalInit = {}) {
    const { cwd = "~", user = "user", host = "macbook", title = `Terminal — ${cwd}`, ...rest } = init;
    super({ ...rest, title, theme: "dark" });

    this.prompt = `${user}@${host} ${cwd} % `;

    const term = this;
    class DynamicBufferNode extends TextNode {
      override propsAt(t: number) {
        const p = super.propsAt(t);
        p.text = term.textAt(t);
        return p;
      }
    }

    this.bufferNode = this.contentArea.add(
      new DynamicBufferNode({
        name: "buffer",
        x: 16,
        y: 16,
        text: this.prompt,
        fontFamily: "SF Mono, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.45,
        color: "#f0f0f0",
      }),
    );
  }

  type(command: string, opts: { at: number; duration: number }): this {
    this.actions.push({
      kind: "type",
      prompt: this.prompt,
      command,
      at: opts.at,
      duration: Math.max(0.01, opts.duration),
    });
    this.actions.sort((a, b) => a.at - b.at);
    return this;
  }

  writeln(text: string, at: number): this {
    this.actions.push({
      kind: "line",
      text,
      at,
    });
    this.actions.sort((a, b) => a.at - b.at);
    return this;
  }

  clear(at: number): this {
    this.actions.push({
      kind: "clear",
      at,
    });
    this.actions.sort((a, b) => a.at - b.at);
    return this;
  }

  textAt(t: number): string {
    const lines: string[] = [];
    let currentLine = this.prompt;

    for (const a of this.actions) {
      if (a.at > t) break;

      if (a.kind === "clear") {
        lines.length = 0;
        currentLine = this.prompt;
      } else if (a.kind === "line") {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }
        lines.push(a.text);
      } else if (a.kind === "type") {
        const progress = Math.min(1, Math.max(0, (t - a.at) / a.duration));
        const chars = Math.floor(progress * a.command.length);
        const typed = a.command.slice(0, chars);
        currentLine = `${a.prompt}${typed}`;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.join("\n");
  }
}

export const terminal = (init?: TerminalInit) => new TerminalNode(init);
