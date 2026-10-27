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
}

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

/** Installs how text is measured (the render worker uses Canvas2D). Text without an explicit size is sized by it. */
export function setTextMeasurer(m: TextMeasurer | undefined): void {
  measurer = m;
}

export class TextNode extends Node<TextProps> {
  constructor(init?: NodeInit<TextProps>) {
    super(
      "text",
      { ...BASE_DEFAULTS, text: "", fontFamily: "SF Pro Text", fontSize: 48, fontWeight: 400, color: "#ffffff", lineHeight: 1.2 },
      init,
    );
  }

  override propsAt(t: number): TextProps {
    const p = super.propsAt(t);
    if (measurer && p.width === 0 && p.height === 0) Object.assign(p, measurer(p));
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
    super("path", { ...BASE_DEFAULTS, d: "", fill: "#ffffff", stroke: "", strokeWidth: 0 }, init);
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
