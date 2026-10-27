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
  /** phase "lost": the GPU device is gone and the worker must be replaced */
  | { type: "error"; phase: "load" | "render" | "lost"; message: string; stack?: string; generation?: number };

export type LoadedInfo = Omit<Extract<FromWorker, { type: "loaded" }>, "type">;
export type SourceLocation = { file: string; line: number; column: number };
export type PreviewError = { phase: "load" | "render" | "timeout" | "lost"; message: string; stack?: string; location?: SourceLocation };
