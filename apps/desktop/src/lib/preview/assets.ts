import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const VIDEO_EXTS = /\.(mp4|webm|mov|m4v)$/i;

/** Extracts an initial frame from a video URL as an ImageBitmap. */
export function loadVideoFrame(url: string, time: number = 0): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = url;

    const onSeeked = async () => {
      try {
        const bitmap = await createImageBitmap(video);
        cleanup();
        resolve(bitmap);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const onLoadedMetadata = () => {
      video.currentTime = Math.min(Math.max(0, time), video.duration || 0);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load video from "${url}"`));
    };

    function cleanup() {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
      video.src = "";
    }

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);
  });
}

/** Loads a project-relative image or video asset through the path-guarded asset protocol. */
export async function loadProjectAsset(src: string): Promise<ImageBitmap> {
  const path = await invoke<string>("asset_url_path", { rel: src });
  const url = convertFileSrc(path);

  if (VIDEO_EXTS.test(src)) {
    return loadVideoFrame(url);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load asset "${src}" (${res.status})`);
  return createImageBitmap(await res.blob());
}

export const loadProjectImage = loadProjectAsset;

/** Bytes of a project file (GLB, HDR, texture) for three() setup, through the same path guard. */
export async function loadProjectBytes(src: string): Promise<ArrayBuffer> {
  const path = await invoke<string>("asset_url_path", { rel: src });
  const res = await fetch(convertFileSrc(path));
  if (!res.ok) throw new Error(`Could not read "${src}" (${res.status})`);
  return res.arrayBuffer();
}

/**
 * Pictures of project videos at any time, for the preview and the export: one <video> per file,
 * seeked to each asked time in turn (a long source video is never loaded whole).
 */
export class VideoFrames {
  private videos = new Map<string, { video: HTMLVideoElement; ready: Promise<void>; queue: Promise<unknown> }>();

  constructor(private readonly urlOf: (src: string) => Promise<string> = projectUrl) {}

  frame = (src: string, time: number): Promise<ImageBitmap> => {
    const entry = this.open(src);
    const next = entry.queue.then(async () => {
      await entry.ready;
      const v = entry.video;
      const target = Math.min(Math.max(0, time), Math.max(0, (v.duration || 0) - 0.001));
      if (Math.abs(v.currentTime - target) > 0.0005 || v.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const done = () => (cleanup(), resolve());
          const fail = () => (cleanup(), reject(new Error(`could not seek "${src}" to ${time}s`)));
          const cleanup = () => {
            v.removeEventListener("seeked", done);
            v.removeEventListener("error", fail);
          };
          v.addEventListener("seeked", done);
          v.addEventListener("error", fail);
          v.currentTime = target;
        });
      }
      return createImageBitmap(v);
    });
    entry.queue = next.catch(() => {});
    return next;
  };

  dispose(): void {
    for (const { video } of this.videos.values()) video.src = "";
    this.videos.clear();
  }

  private open(src: string) {
    let entry = this.videos.get(src);
    if (entry) return entry;
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    const ready = this.urlOf(src).then(
      (url) =>
        new Promise<void>((resolve, reject) => {
          video.addEventListener("loadeddata", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error(`could not load video "${src}"`)), { once: true });
          video.src = url;
        }),
    );
    ready.catch(() => this.videos.delete(src));
    entry = { video, ready, queue: Promise.resolve() };
    this.videos.set(src, entry);
    return entry;
  }
}

async function projectUrl(src: string): Promise<string> {
  return convertFileSrc(await invoke<string>("asset_url_path", { rel: src }));
}
