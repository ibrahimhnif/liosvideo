import type { TextProps } from "../graph/kinds";
import type { TextItem } from "../renderlist";

type TextStyle = Pick<TextProps, "text" | "fontFamily" | "fontSize" | "fontWeight" | "lineHeight">;

const fontOf = (s: TextStyle, scale: number) => `${s.fontWeight} ${s.fontSize * scale}px "${s.fontFamily}", system-ui`;

let measureCtx: OffscreenCanvasRenderingContext2D | undefined;

/** Layout box of a text block at `scale` (device pixels per unit). Shared by measurement and rasterization. */
function layout(s: TextStyle, scale: number) {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext("2d")!;
  measureCtx.font = fontOf(s, scale);
  const lines = s.text.split("\n");
  const metrics = lines.map((l) => measureCtx!.measureText(l));
  const lineHeight = s.fontSize * s.lineHeight * scale;
  return { lines, metrics, lineHeight, width: Math.max(0, ...metrics.map((m) => m.width)), height: lineHeight * lines.length };
}

/** Text size in layout units, for setTextMeasurer(). */
export function measureText(s: TextStyle): { width: number; height: number } {
  const { width, height } = layout(s, 1);
  return { width, height };
}

export type RasterizedText = {
  /** cache key: identical keys produce identical rasters */
  key: string;
  canvas: OffscreenCanvas;
  /** size in the item's local units (canvas pixels / scale) */
  width: number;
  height: number;
};

/** Rasterizes text with Canvas2D at the exact device scale, so text is never scaled up from a smaller raster. */
export class TextRasterizer {
  private cache = new Map<string, RasterizedText>();

  get size(): number {
    return this.cache.size;
  }

  /** Drops every cached raster whose key is not in `keep`. Call between frames only. */
  retain(keep: Set<string>): void {
    for (const key of this.cache.keys()) if (!keep.has(key)) this.cache.delete(key);
  }

  raster(item: TextItem, scale: number): RasterizedText {
    const key = JSON.stringify([item.text, item.fontFamily, item.fontSize, item.fontWeight, item.color, item.lineHeight, scale]);
    let hit = this.cache.get(key);
    if (hit) return hit;

    const box = layout(item, scale);
    const { lines, metrics, lineHeight } = box;
    const width = Math.max(1, Math.ceil(box.width));
    const height = Math.max(1, Math.ceil(box.height));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.font = fontOf(item, scale);
    ctx.fillStyle = item.color;
    ctx.textBaseline = "alphabetic";
    lines.forEach((line, i) => {
      const m = metrics[i];
      const ascent = m.fontBoundingBoxAscent;
      const descent = m.fontBoundingBoxDescent;
      ctx.fillText(line, 0, i * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent);
    });
    hit = { key, canvas, width: width / scale, height: height / scale };
    this.cache.set(key, hit);
    return hit;
  }
}
