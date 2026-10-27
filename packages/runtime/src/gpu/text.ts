import type { TextItem } from "../renderlist";

export type RasterizedText = {
  canvas: OffscreenCanvas;
  /** size in the item's local units (canvas pixels / scale) */
  width: number;
  height: number;
};

/** Rasterizes text with Canvas2D at the exact device scale, so text is never scaled up from a smaller raster. */
export class TextRasterizer {
  private cache = new Map<string, RasterizedText>();

  raster(item: TextItem, scale: number): RasterizedText {
    const key = JSON.stringify([item.text, item.fontFamily, item.fontSize, item.fontWeight, item.color, item.lineHeight, scale]);
    let hit = this.cache.get(key);
    if (hit) return hit;
    if (this.cache.size > 512) this.cache.clear();

    const font = `${item.fontWeight} ${item.fontSize * scale}px "${item.fontFamily}", system-ui`;
    const lines = item.text.split("\n");
    const lineHeight = item.fontSize * item.lineHeight * scale;
    const measure = new OffscreenCanvas(1, 1).getContext("2d")!;
    measure.font = font;
    const metrics = lines.map((l) => measure.measureText(l));
    const width = Math.max(1, Math.ceil(Math.max(0, ...metrics.map((m) => m.width))));
    const height = Math.max(1, Math.ceil(lineHeight * lines.length));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    ctx.fillStyle = item.color;
    ctx.textBaseline = "alphabetic";
    lines.forEach((line, i) => {
      const m = metrics[i];
      const ascent = m.fontBoundingBoxAscent;
      const descent = m.fontBoundingBoxDescent;
      ctx.fillText(line, 0, i * lineHeight + (lineHeight - (ascent + descent)) / 2 + ascent);
    });
    hit = { canvas, width: width / scale, height: height / scale };
    this.cache.set(key, hit);
    return hit;
  }
}
