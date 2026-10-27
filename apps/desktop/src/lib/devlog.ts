import { invoke } from "@tauri-apps/api/core";

/** Mirrors a diagnostic line to console and the `tauri dev` terminal. */
export function devLog(message: string): void {
  console.log(message);
  invoke("dev_log", { message: `${Date.now()} ${message}` }).catch(() => {});
}

/** Saves PNGs of the given frames to LIOSVIDEO_SNAPSHOT_DIR, if set (development builds only). */
export async function devSnapshots(
  name: string,
  frames: number[],
  render: (frame: number) => Promise<void>,
  snapshot: () => Promise<ArrayBuffer>,
): Promise<void> {
  if (!import.meta.env.DEV || !(await invoke<string | null>("dev_snapshot_dir"))) return;
  for (const f of frames) {
    await render(f);
    const bytes = Array.from(new Uint8Array(await snapshot()));
    await invoke("dev_write_snapshot", { name: `${name}-${String(f).padStart(4, "0")}.png`, bytes });
  }
  devLog(`snapshots ${name} ${frames.join(",")}`);
}
