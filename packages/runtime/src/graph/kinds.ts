import { pathBounds } from "../math/svgpath";
import { BASE_DEFAULTS, Node, type BaseProps, type NodeInit } from "./node";

export interface RectProps extends BaseProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface TextProps extends BaseProps {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  lineHeight: number;
  /** Line alignment inside the text box. */
  align: TextAlign;
  /** Wraps words onto new lines past this width (layout units); 0 = only `\n` breaks. The box is then this wide. */
  maxWidth: number;
}

export type TextAlign = "left" | "center" | "right";

export type ImageFit = "fill" | "contain" | "cover";

export interface ImageProps extends BaseProps {
  src: string;
  fit: ImageFit;
}

export interface VideoProps extends BaseProps {
  src: string;
  fit: ImageFit;
  startOffset: number;
  speed: number;
  loop: boolean;
}

export class GroupNode extends Node<BaseProps> {
  constructor(init?: NodeInit<BaseProps>) {
    super("group", BASE_DEFAULTS, init);
  }
}

export class RectNode extends Node<RectProps> {
  constructor(init?: NodeInit<RectProps>) {
    super("rect", { ...BASE_DEFAULTS, fill: "#ffffff", stroke: "", strokeWidth: 0 }, init);
  }
}

export type TextMeasurer = (p: TextProps) => { width: number; height: number };

let measurer: TextMeasurer | undefined;
const wrapCache = new Map<string, string>();
const WRAP_CACHE_LIMIT = 2048;

/** Installs how text is measured (the render worker uses Canvas2D). Text without an explicit size is sized by it. */
export function setTextMeasurer(m: TextMeasurer | undefined): void {
  measurer = m;
  wrapCache.clear();
}

/** Greedy word wrap: each `\n` line is broken at spaces so no line is wider than `maxWidth`; a lone long word keeps its own line. */
function wrapText(p: TextProps, m: TextMeasurer): string {
  const key = JSON.stringify([p.text, p.fontFamily, p.fontSize, p.fontWeight, p.lineHeight, p.maxWidth]);
  const hit = wrapCache.get(key);
  if (hit !== undefined) return hit;
  const fits = (line: string) => m({ ...p, text: line }).width <= p.maxWidth;
  const out: string[] = [];
  for (const hard of p.text.split("\n")) {
    let line = "";
    for (const word of hard.split(" ").filter((w) => w !== "")) {
      const next = line ? `${line} ${word}` : word;
      if (line && !fits(next)) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  const wrapped = out.join("\n");
  if (wrapCache.size >= WRAP_CACHE_LIMIT) wrapCache.clear();
  wrapCache.set(key, wrapped);
  return wrapped;
}

export class TextNode extends Node<TextProps> {
  constructor(init?: NodeInit<TextProps>) {
    super(
      "text",
      { ...BASE_DEFAULTS, text: "", fontFamily: "SF Pro Text", fontSize: 48, fontWeight: 400, color: "#ffffff", lineHeight: 1.2, align: "left", maxWidth: 0 },
      init,
    );
  }

  override propsAt(t: number): TextProps {
    const p = super.propsAt(t);
    if (!measurer) return p;
    if (p.maxWidth > 0) p.text = wrapText(p, measurer);
    if (p.width === 0 && p.height === 0) {
      const size = measurer(p);
      p.width = p.maxWidth > 0 ? p.maxWidth : size.width;
      p.height = size.height;
    }
    return p;
  }
}

export class ImageNode extends Node<ImageProps> {
  constructor(init: NodeInit<ImageProps> & { src: string }) {
    super("image", { ...BASE_DEFAULTS, src: "", fit: "fill" }, init);
  }
}

export class VideoNode extends Node<VideoProps> {
  constructor(init: NodeInit<VideoProps> & { src: string }) {
    super("video", { ...BASE_DEFAULTS, src: "", fit: "fill", startOffset: 0, speed: 1.0, loop: false }, init);
  }
}

export interface CircleProps extends BaseProps {
  radius: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export class CircleNode extends Node<CircleProps> {
  constructor(init?: NodeInit<CircleProps> & { radius?: number }) {
    const r = init?.radius ?? 50;
    const diameter = r * 2;
    super(
      "circle",
      { ...BASE_DEFAULTS, width: diameter, height: diameter, radius: r, fill: "#ffffff", stroke: "", strokeWidth: 0 },
      { ...init, width: init?.width ?? diameter, height: init?.height ?? diameter, radius: r },
    );
  }
}

export interface PathProps extends BaseProps {
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export class PathNode extends Node<PathProps> {
  constructor(init: NodeInit<PathProps> & { d: string }) {
    const bounds = pathBounds(init.d, init.stroke ? (init.strokeWidth ?? 0) : 0);
    super("path", { ...BASE_DEFAULTS, d: "", fill: "#ffffff", stroke: "", strokeWidth: 0 }, {
      ...init,
      width: init.width ?? bounds.width,
      height: init.height ?? bounds.height,
    });
  }
}

export interface ShaderProps extends BaseProps {
  code: string;
  uniforms?: Record<string, number | number[]>;
}

export class ShaderNode extends Node<ShaderProps> {
  constructor(init: NodeInit<ShaderProps> & { code: string }) {
    super("shader", { ...BASE_DEFAULTS, code: "", uniforms: {} }, init);
  }
}

export const group = (init?: NodeInit<BaseProps>) => new GroupNode(init);
export const rect = (init?: NodeInit<RectProps>) => new RectNode(init);
export const circle = (init?: NodeInit<CircleProps> & { radius?: number }) => new CircleNode(init);
export const path = (init: NodeInit<PathProps> & { d: string }) => new PathNode(init);
export const shader = (init: NodeInit<ShaderProps> & { code: string }) => new ShaderNode(init);
export const text = (init: NodeInit<TextProps>) => new TextNode(init);
export const image = (init: NodeInit<ImageProps> & { src: string }) => new ImageNode(init);
export const video = (init: NodeInit<VideoProps> & { src: string }) => new VideoNode(init);
export { three, ThreeNode, type ThreeProps, type ThreeSetupContext } from "./three";
