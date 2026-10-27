import type { SceneSpan } from "liosvideo";

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "resize"; width: number; height: number }
  | { type: "load"; code: string; generation: number }
  | { type: "render"; frame: number; id: number }
  | { type: "assets"; bitmaps: [string, ImageBitmap][] }
  | { type: "snapshot"; id: number };

export type FromWorker =
  | {
      type: "loaded";
      generation: number;
      width: number;
      height: number;
      fps: number;
      totalFrames: number;
      scenes: SceneSpan[];
      /** collectAssets */
      assets: string[];
    }
  | { type: "rendered"; id: number; frame: number }
  /** PNG of the last rendered frame */
  | { type: "snapshot"; id: number; png?: ArrayBuffer; error?: string }
  | { type: "error"; phase: "load" | "render"; message: string; stack?: string; generation?: number };

export type LoadedInfo = Omit<Extract<FromWorker, { type: "loaded" }>, "type">;
export type PreviewError = { phase: "load" | "render" | "timeout"; message: string; stack?: string };
