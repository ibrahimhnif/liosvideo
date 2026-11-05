import type { ImageFit } from "./graph/kinds";
import type { Affine } from "./math/affine";
import type { PathBounds } from "./math/svgpath";

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
  /** Tight local-space box of `d` (stroke included) that the rasterised quad covers. */
  bounds: PathBounds;
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
  /** scene-relative seconds */
  time: number;
  /** 0..1 scene progress */
  progress: number;
};

export type ThreeItem = {
  kind: "three";
  path: string;
  matrix: Affine;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  opacity: number;
  /** scene-relative seconds */
  time: number;
  /** scene duration in seconds */
  duration: number;
};

/** Layer filters, run after blur in the order pixelate → posterize → halftone → outline → chalk → glow. */
export type Filters = {
  pixelate: number;
  posterize: number;
  halftone: number;
  outline: number;
  outlineColor: string;
  chalk: number;
  glow: number;
  glowIntensity: number;
};

export type LayerItem = {
  kind: "layer";
  path: string;
  items: RenderItem[];
  opacity: number;
  blur: number;
  /** present only when at least one filter is on */
  filters?: Filters;
  clip?: { matrix: Affine; width: number; height: number; radius: number };
};

export type RenderItem = RectItem | CircleItem | PathItem | ShaderItem | TextItem | ImageItem | VideoItem | ThreeItem | LayerItem;

export type RenderList = { width: number; height: number; background: string; items: RenderItem[]; assets: string[] };
