import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

/** A newer release found on GitHub Releases (`latest.json`). */
export type UpdateInfo = { version: string; currentVersion: string; notes?: string };

/**
 * Over-the-air updates for the desktop app. The Tauri updater plugin reads
 * `latest.json` from the newest GitHub release, downloads the bundle for this
 * platform, checks its signature against the public key in tauri.conf.json and
 * swaps the app in place; `restart` relaunches into the new version.
 */
export interface UpdateApi {
  check(): Promise<UpdateInfo | null>;
  /** Downloads and installs the update `check` found. `progress` is 0–1, or null while the size is unknown. */
  install(onProgress: (progress: number | null) => void): Promise<void>;
  restart(): Promise<void>;
}

export function createTauriUpdateApi(): UpdateApi {
  let pending: Update | null = null;
  return {
    async check() {
      const { check } = await import("@tauri-apps/plugin-updater");
      pending = await check();
      if (!pending) return null;
      return { version: pending.version, currentVersion: pending.currentVersion, notes: pending.body ?? undefined };
    },
    async install(onProgress) {
      if (!pending) throw new Error("No update to install; check for updates first.");
      let total = 0;
      let done = 0;
      await pending.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          onProgress(total ? 0 : null);
        } else if (event.event === "Progress") {
          done += event.data.chunkLength;
          onProgress(total ? Math.min(done / total, 1) : null);
        } else {
          onProgress(1);
        }
      });
    },
    async restart() {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
