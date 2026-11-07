import type { SceneSpan, TimelineManifest } from "liosvideo";

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "resize"; width: number; height: number }
  | { type: "load"; code: string; generation: number }
  | { type: "render"; frame: number; id: number }
  | { type: "assets"; bitmaps: [string, ImageBitmap][] }
  | { type: "snapshot"; id: number }
  | { type: "timings"; timings: Record<string, any> }
  | { type: "attributions"; markdown: string }
  /** answer to readAsset: the file's bytes, or why it could not be read */
  | { type: "assetBytes"; id: number; bytes?: ArrayBuffer; error?: string };

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
      manifest: TimelineManifest;
    }
  | { type: "rendered"; id: number; frame: number }
  /** three() setup asked for a project file (gltf / hdr / texture) */
  | { type: "readAsset"; id: number; src: string }
  /** PNG of the last rendered frame */
  | { type: "snapshot"; id: number; png?: ArrayBuffer; error?: string }
  /** phase "lost": the GPU device is gone and the worker must be replaced */
  | { type: "error"; phase: "load" | "render" | "lost"; message: string; stack?: string; generation?: number };

export type LoadedInfo = Omit<Extract<FromWorker, { type: "loaded" }>, "type">;
export type SourceLocation = { file: string; line: number; column: number };
export type PreviewError = { phase: "load" | "render" | "timeout" | "lost"; message: string; stack?: string; location?: SourceLocation };
