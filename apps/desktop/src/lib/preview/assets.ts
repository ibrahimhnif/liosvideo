import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Loads a project-relative image through the path-guarded asset protocol. */
export async function loadProjectImage(src: string): Promise<ImageBitmap> {
  const path = await invoke<string>("asset_url_path", { rel: src });
  const res = await fetch(convertFileSrc(path));
  if (!res.ok) throw new Error(`Could not load asset "${src}" (${res.status})`);
  return createImageBitmap(await res.blob());
}
