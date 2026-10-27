import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type HistoryStatus = { kind: "enabled" } | { kind: "off" } | { kind: "nested"; repo: string };
export type CommitInfo = { id: string; shortId: string; summary: string; message: string; /** unix seconds */ time: number };
export type FileDiff = { path: string; status: "added" | "modified" | "deleted" | "renamed"; binary: boolean; patch: string; truncated: boolean };

export interface HistoryApi {
  history(limit: number): Promise<CommitInfo[]>;
  diff(id: string): Promise<FileDiff[]>;
  checkpoint(message: string): Promise<CommitInfo | null>;
  restore(id: string): Promise<CommitInfo>;
  enable(): Promise<HistoryStatus>;
  /** Calls `cb` after any commit the app makes; returns an unsubscribe function. */
  onCommitted(cb: () => void): () => void;
}

export const tauriHistoryApi: HistoryApi = {
  history: (limit) => invoke("project_history", { limit }),
  diff: (id) => invoke("commit_diff", { id }),
  checkpoint: (message) => invoke("checkpoint", { message }),
  restore: (id) => invoke("restore_commit", { id }),
  enable: () => invoke("enable_history"),
  onCommitted(cb) {
    const off = listen("project://committed", () => cb());
    return () => void off.then((f) => f());
  },
};
