/** The ten animation styles, in the order the picker and the showcase list them. */
export type StyleInfo = {
  id: string;
  title: string;
  /** a creator or medium the look is modelled on */
  inspiration?: string;
  description: string;
  ratio: "16:9" | "9:16" | "both";
  /** built with three() */
  three: boolean;
};

export const STYLES: StyleInfo[] = [
  { id: "pixel-art", title: "Pixel Art", inspiration: "16-bit games", description: "Chunky pixels, a limited palette and stepped motion.", ratio: "both", three: false },
  { id: "chalkboard", title: "Chalkboard", inspiration: "classroom chalk talks", description: "Chalk lines and handwriting written onto a green board.", ratio: "both", three: false },
  { id: "glow-sketch", title: "Glow Sketch", inspiration: "neon line art", description: "Glowing line drawings that draw themselves on black.", ratio: "both", three: false },
  { id: "ps2-lowpoly", title: "PS2 Style", inspiration: "early-2000s console games", description: "Low-poly 3D at low resolution, with fog and wobbly vertices.", ratio: "both", three: true },
  { id: "comic", title: "Comic Art", inspiration: "comic books", description: "Panels, ink outlines, halftone shading and action words.", ratio: "both", three: false },
  { id: "flat-vector", title: "Flat Vector", inspiration: "explainer infographics", description: "Flat colour shapes with no gradients and bouncy motion.", ratio: "both", three: false },
  { id: "minimal-mono", title: "Minimal Mono (Dan Koe style)", inspiration: "Dan Koe", description: "Black and white serif statements with a hand-drawn underline.", ratio: "both", three: false },
  { id: "cgi-motion", title: "CGI Motion", inspiration: "product CGI", description: "A glossy soft-lit 3D object on a slow orbiting camera.", ratio: "both", three: true },
  { id: "brick", title: "Brick Build (LEGO-like)", inspiration: "LEGO-like toy bricks", description: "Toy bricks with studs that drop in and stack into shapes.", ratio: "both", three: true },
  { id: "explainer-3d", title: "3D Explainer (ZackD Films style)", inspiration: "ZackD Films", description: "Soft 3D close-ups with shallow depth of field and captions.", ratio: "9:16", three: true },
];
