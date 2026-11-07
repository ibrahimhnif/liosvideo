// Export presets: the same table as the CLI's `--preset` (apps/cli/src/pipeline/preset.rs).

export type ExportPresetId = "native" | "1080p" | "4k" | "shorts" | "preview" | "tiktok" | "reels" | "youtube";

export interface ExportPresetInfo {
  id: ExportPresetId;
  label: string;
}

export const EXPORT_PRESETS: ExportPresetInfo[] = [
  { id: "native", label: "Native" },
  { id: "1080p", label: "1080p Full HD" },
  { id: "4k", label: "4K Ultra HD" },
  { id: "shorts", label: "Vertical 9:16 Shorts" },
  { id: "preview", label: "Preview (720p, small file)" },
  { id: "tiktok", label: "TikTok" },
  { id: "reels", label: "Instagram Reels" },
  { id: "youtube", label: "YouTube" },
];

export interface ExportPreset {
  width: number;
  height: number;
  /** H.264 bits per second */
  bitrate: number;
  /** AAC bits per second */
  audioBitrate: number;
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Output size and bitrates of a preset for a composition of `width` x `height`. */
export function exportPreset(id: ExportPresetId, width: number, height: number): ExportPreset {
  const base = { bitrate: 10_000_000, audioBitrate: 192_000 };
  switch (id) {
    case "1080p":
      return { ...base, width: 1920, height: 1080 };
    case "4k":
      return { ...base, width: 3840, height: 2160, bitrate: 30_000_000 };
    case "shorts":
    case "tiktok":
    case "reels":
      return { ...base, width: 1080, height: 1920 };
    case "youtube":
      // a vertical composition goes up as a Short
      return { width: height > width ? 1080 : 1920, height: height > width ? 1920 : 1080, bitrate: 12_000_000, audioBitrate: 320_000 };
    case "preview": {
      // 720p: the short side is 720, never scaled up
      const k = Math.min(1, 720 / Math.max(1, Math.min(width, height)));
      return { width: even(width * k), height: even(height * k), bitrate: 600_000, audioBitrate: 96_000 };
    }
    default:
      return { ...base, width, height };
  }
}
