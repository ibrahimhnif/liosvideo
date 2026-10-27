import { invoke } from "@tauri-apps/api/core";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

export async function saveExportedVideoChunks(
  filename: string,
  bytes: Uint8Array,
  invoker: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> = invoke,
  chunkSize: number = 2 * 1024 * 1024,
): Promise<string> {
  if (bytes.length === 0) {
    return invoker<string>("save_exported_video_chunk", {
      filename,
      chunkBase64: "",
      append: false,
    });
  }

  let finalPath = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    const chunkBase64 = uint8ArrayToBase64(slice);
    finalPath = await invoker<string>("save_exported_video_chunk", {
      filename,
      chunkBase64,
      append: offset > 0,
    });
  }

  return finalPath;
}
