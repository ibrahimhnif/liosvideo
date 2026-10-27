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
