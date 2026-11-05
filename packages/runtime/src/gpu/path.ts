import type { PathItem } from "../renderlist";

/** Transparent margin kept around the shape so antialiased edges are not clipped. */
export const PATH_PAD_PX = 1;

export type RasterizedPath = {
  /** cache key: identical keys produce identical rasters */
  key: string;
  canvas: OffscreenCanvas;
  /** size in the item's local units (canvas pixels / scale) */
  width: number;
  height: number;
  /** local-space origin of the quad: `bounds` min shifted by the padded margin */
  x: number;
  y: number;
};

/**
 * Rasterises SVG `d` paths with Canvas2D at the exact device scale.
 * Both renderers use the same rule: the canvas covers `bounds` plus a one-pixel
 * transparent margin, mapped by `scale` device pixels per local unit.
 */
export class PathRasterizer {
  private cache = new Map<string, RasterizedPath>();

  get size(): number {
    return this.cache.size;
  }

  /** Drops every cached raster whose key is not in `keep`. Call between frames only. */
  retain(keep: Set<string>): void {
    for (const key of this.cache.keys()) if (!keep.has(key)) this.cache.delete(key);
  }

  raster(item: PathItem, scale: number): RasterizedPath {
    const bounds = item.bounds;
    const key = JSON.stringify([item.d, item.fill, item.stroke ?? "", item.strokeWidth, bounds.x, bounds.y, bounds.width, bounds.height, scale]);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const widthPx = Math.min(8192, Math.max(1, Math.ceil(bounds.width * scale) + PATH_PAD_PX * 2));
    const heightPx = Math.min(8192, Math.max(1, Math.ceil(bounds.height * scale) + PATH_PAD_PX * 2));
    const originX = bounds.x - PATH_PAD_PX / scale;
    const originY = bounds.y - PATH_PAD_PX / scale;

    const canvas = new OffscreenCanvas(widthPx, heightPx);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, -originX * scale, -originY * scale);
    const outline = new Path2D(item.d);
    if (item.fill) {
      ctx.fillStyle = item.fill;
      ctx.fill(outline);
    }
    if (item.stroke && item.strokeWidth > 0) {
      ctx.strokeStyle = item.stroke;
      ctx.lineWidth = item.strokeWidth;
      ctx.stroke(outline);
    }

    const raster = { key, canvas, width: widthPx / scale, height: heightPx / scale, x: originX, y: originY };
    this.cache.set(key, raster);
    return raster;
  }
}
