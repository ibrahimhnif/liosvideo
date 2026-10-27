import type { ImageFit } from "./graph/kinds";
import type { Affine } from "./math/affine";

export type RectItem = {
  kind: "rect";
  path: string;
  matrix: Affine;
  width: number;
  height: number;
  radius: number;
  fill: string;
  stroke?: string;
  strokeWidth: number;
  opacity: number;
};

export type TextItem = {
  kind: "text";
  path: string;
  matrix: Affine;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  lineHeight: number;
  opacity: number;
};

export type ImageItem = {
  kind: "image";
  path: string;
  matrix: Affine;
  src: string;
  width: number;
  height: number;
  fit: ImageFit;
  opacity: number;
};

export type VideoItem = {
  kind: "video";
  path: string;
  matrix: Affine;
  src: string;
  time: number;
  width: number;
  height: number;
  fit: ImageFit;
  opacity: number;
};

export type CircleItem = {
  kind: "circle";
  path: string;
  matrix: Affine;
  radius: number;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
  strokeWidth: number;
  opacity: number;
};

export type PathItem = {
  kind: "path";
  path: string;
  matrix: Affine;
  d: string;
  width: number;
  height: number;
  fill: string;
  stroke?: string;
  strokeWidth: number;
  opacity: number;
};

export type ShaderItem = {
  kind: "shader";
  path: string;
  matrix: Affine;
  code: string;
  width: number;
  height: number;
  uniforms?: Record<string, number | number[]>;
  opacity: number;
};

export type LayerItem = {
  kind: "layer";
  path: string;
  items: RenderItem[];
  opacity: number;
  blur: number;
  clip?: { matrix: Affine; width: number; height: number; radius: number };
};

export type RenderItem = RectItem | CircleItem | PathItem | ShaderItem | TextItem | ImageItem | VideoItem | LayerItem;

export type RenderList = { width: number; height: number; background: string; items: RenderItem[]; assets: string[] };
