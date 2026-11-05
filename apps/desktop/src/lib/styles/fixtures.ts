import type { StyleInfo } from "./api";

/** The ten styles as `list_styles` returns them (mirrors STYLES in scaffold.rs). */
export const STYLE_FIXTURE: StyleInfo[] = [
  { id: "pixel-art", title: "Pixel Art" },
  { id: "chalkboard", title: "Chalkboard" },
  { id: "glow-sketch", title: "Glow Sketch" },
  { id: "ps2-lowpoly", title: "PS2 Style" },
  { id: "comic", title: "Comic Art" },
  { id: "flat-vector", title: "Flat Vector" },
  { id: "minimal-mono", title: "Minimal Mono (Dan Koe style)" },
  { id: "cgi-motion", title: "CGI Motion" },
  { id: "brick", title: "Brick Build (LEGO-like)" },
  { id: "explainer-3d", title: "3D Explainer (ZackD Films style)" },
];
