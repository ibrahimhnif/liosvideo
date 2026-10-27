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

export class TextNode extends Node<TextProps> {
  constructor(init?: NodeInit<TextProps>) {
    super(
      "text",
      { ...BASE_DEFAULTS, text: "", fontFamily: "SF Pro Text", fontSize: 48, fontWeight: 400, color: "#ffffff", lineHeight: 1.2 },
      init,
    );
  }
}

export class ImageNode extends Node<ImageProps> {
  constructor(init: NodeInit<ImageProps> & { src: string }) {
    super("image", { ...BASE_DEFAULTS, src: "", fit: "fill" }, init);
  }
}

export const group = (init?: NodeInit<BaseProps>) => new GroupNode(init);
export const rect = (init?: NodeInit<RectProps>) => new RectNode(init);
export const text = (init: NodeInit<TextProps>) => new TextNode(init);
export const image = (init: NodeInit<ImageProps> & { src: string }) => new ImageNode(init);
