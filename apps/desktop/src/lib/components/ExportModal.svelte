<script lang="ts">
  import {
    AlertCircle,
    CheckCircle2,
    Film,
    FolderOpen,
    X,
  } from "@lucide/svelte";
  import type { ExportConfig } from "$lib/export/export_engine";

  let {
    open = false,
    compositionName = "composition",
    width = 1920,
    height = 1080,
    fps = 30,
    totalFrames = 0,
    onClose,
    onStartExport,
    onCancelExport,
    onShowInFinder,
  }: {
    open: boolean;
    compositionName: string;
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
    onClose: () => void;
    onStartExport: (config: ExportConfig, onProgress: (pct: number, stage?: string, logLine?: string) => void) => Promise<string>;
    onCancelExport?: () => void;
    onShowInFinder?: (filePath: string) => Promise<void>;
  } = $props();

  let preset = $state<"native" | "1080p" | "4k" | "shorts">("native");
  let selectedFps = $state(30);
  let status = $state<"idle" | "exporting" | "done" | "error">("idle");
  let progress = $state(0);
  let currentStage = $state("Starting export...");
  let logLines = $state<string[]>([]);
  let outputPath = $state("");
  let errorMessage = $state("");
  let wasOpen = false;

  $effect(() => {
    selectedFps = fps;
  });

  $effect(() => {
    if (open && !wasOpen) {
      selectedFps = fps;
      status = "idle";
      progress = 0;
      currentStage = "Starting export...";
      logLines = [];
      outputPath = "";
      errorMessage = "";
    }
    wasOpen = open;
  });

  const targetResolution = $derived.by(() => {
    switch (preset) {
      case "1080p":
        return { w: 1920, h: 1080, bitrate: 10_000_000 };
      case "4k":
        return { w: 3840, h: 2160, bitrate: 30_000_000 };
      case "shorts":
        return { w: 1080, h: 1920, bitrate: 10_000_000 };
      default:
        return { w: width, h: height, bitrate: 10_000_000 };
    }
  });

  async function handleStart() {
    status = "exporting";
    progress = 0;
    currentStage = "Starting export...";
    logLines = [];
    errorMessage = "";
    try {
      const config: ExportConfig = {
        width: targetResolution.w,
        height: targetResolution.h,
        fps: selectedFps,
        totalFrames,
        bitrate: targetResolution.bitrate,
      };
      const resultPath = await onStartExport(config, (pct, stage, log) => {
        progress = pct;
        if (stage) currentStage = stage;
        if (log) {
          const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          logLines = [...logLines.slice(-49), `[${time}] ${log}`];
        }
      });
      outputPath = resultPath;
      status = "done";
    } catch (e) {
      if ((e as Error).message === "Export cancelled") {
        status = "idle";
      } else {
        errorMessage = (e as Error).message;
        status = "error";
      }
    }
  }

  function handleCancel() {
    if (status === "exporting") {
      onCancelExport?.();
      status = "idle";
    } else {
      onClose();
    }
  }

  async function handleFinder() {
    if (outputPath && onShowInFinder) {
      await onShowInFinder(outputPath);
    }
  }
</script>

{#if open}
  <div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <div class="modal">
      <div class="header">
        <h2 id="export-title">
          <Film size={16} />
          <span>Export Composition</span>
        </h2>
        <button class="close" onclick={handleCancel} aria-label="Close modal">
          <X size={16} />
        </button>
      </div>

      <div class="content">
        {#if status === "idle"}
          <div class="field">
            <label for="preset-select">Preset</label>
            <select id="preset-select" bind:value={preset}>
              <option value="native">Native ({width} × {height})</option>
              <option value="1080p">1080p Full HD (1920 × 1080)</option>
              <option value="4k">4K Ultra HD (3840 × 2160)</option>
              <option value="shorts">Vertical 9:16 Shorts/Reels (1080 × 1920)</option>
            </select>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <span class="label">Resolution</span>
              <span class="value" data-testid="resolution-value">{targetResolution.w} × {targetResolution.h}</span>
            </div>
            <div class="info-item">
              <span class="label">Framerate</span>
              <span class="value">{selectedFps} fps</span>
            </div>
            <div class="info-item">
              <span class="label">Frames</span>
              <span class="value">{totalFrames} frames ({(totalFrames / selectedFps).toFixed(1)}s)</span>
            </div>
            <div class="info-item">
              <span class="label">Codec</span>
              <span class="value">H.264 / AAC (MP4)</span>
            </div>
          </div>
        {:else if status === "exporting"}
          <div class="exporting-view">
            <div class="spinner"></div>
            <div class="progress-bar">
              <div class="progress-fill" style:width="{progress}%"></div>
            </div>
            <span class="progress-text">Exporting... {progress}%</span>
            <span class="progress-stage" data-testid="progress-stage">{currentStage}</span>
            <div class="log-container" data-testid="export-logs">
              {#if logLines.length === 0}
                <div class="log-line text-muted">Waiting for export pipeline...</div>
              {:else}
                {#each logLines.slice(-5) as line}
                  <div class="log-line">{line}</div>
                {/each}
              {/if}
            </div>
          </div>
        {:else if status === "done"}
          <div class="done-view">
            <span class="success-icon"><CheckCircle2 size={40} /></span>
            <h3>Export Completed!</h3>
            <p class="file-path">{outputPath}</p>
          </div>
        {:else if status === "error"}
          <div class="error-view">
            <span class="error-icon"><AlertCircle size={40} /></span>
            <h3>Export Failed</h3>
            <p class="error-msg">{errorMessage}</p>
          </div>
        {/if}
      </div>

      <div class="footer">
        {#if status === "idle"}
          <button class="btn secondary" onclick={onClose}>Cancel</button>
          <button class="btn primary" onclick={handleStart}>
            <Film size={14} />
            <span>Start Export</span>
          </button>
        {:else if status === "exporting"}
          <button class="btn danger" onclick={handleCancel}>Cancel Export</button>
        {:else if status === "done"}
          {#if onShowInFinder}
            <button class="btn secondary" onclick={handleFinder}>
              <FolderOpen size={14} />
              <span>Show in Finder</span>
            </button>
          {/if}
          <button class="btn primary" onclick={onClose}>Close</button>
        {:else if status === "error"}
          <button class="btn secondary" onclick={onClose}>Close</button>
          <button class="btn primary" onclick={handleStart}>Try Again</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
    z-index: 9999;
  }
  .modal {
    background: var(--panel, #18181b);
    border: 1px solid var(--border, #2e2e34);
    border-radius: 10px;
    width: 440px;
    max-width: 90vw;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    color: var(--fg, #ececf0);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border, #2e2e34);
  }
  .header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .close {
    background: none;
    border: none;
    color: var(--muted, #8d8d98);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .close:hover {
    color: var(--fg, #ececf0);
  }
  .content {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field label {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted, #8d8d98);
  }
  select {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--raised, #232328);
    border: 1px solid var(--border, #2e2e34);
    color: var(--fg, #ececf0);
    font: inherit;
    font-size: 13px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    background: var(--raised, #232328);
    padding: 12px;
    border-radius: 6px;
    border: 1px solid var(--border, #2e2e34);
  }
  .info-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .info-item .label {
    font-size: 11px;
    color: var(--muted, #8d8d98);
  }
  .info-item .value {
    font-size: 13px;
    font-weight: 500;
  }
  .exporting-view, .done-view, .error-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 16px 0;
    gap: 12px;
  }
  .progress-bar {
    width: 100%;
    height: 8px;
    background: var(--raised, #232328);
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #4f8cff;
    transition: width 0.15s ease-out;
  }
  .progress-text {
    font-size: 13px;
    font-weight: 500;
  }
  .progress-stage {
    font-size: 12px;
    color: var(--muted, #8d8d98);
    font-weight: 500;
  }
  .log-container {
    width: 100%;
    box-sizing: border-box;
    background: var(--raised, #1b1b1f);
    border: 1px solid var(--border, #2e2e34);
    border-radius: 6px;
    padding: 8px 10px;
    text-align: left;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    color: #a1a1aa;
    line-height: 1.4;
    max-height: 90px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .log-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .text-muted {
    color: #63636e;
    font-style: italic;
  }
  .success-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #10b981;
  }
  .error-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--danger, #ff5a5a);
  }
  .file-path {
    font-size: 11px;
    color: var(--muted, #8d8d98);
    word-break: break-all;
    margin: 0;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 18px;
    border-top: 1px solid var(--border, #2e2e34);
    background: color-mix(in srgb, var(--panel, #18181b) 80%, black);
  }
  .btn {
    padding: 6px 14px;
    border-radius: 6px;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border, #2e2e34);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn.primary {
    background: #4f8cff;
    border-color: #4f8cff;
    color: white;
  }
  .btn.secondary {
    background: var(--raised, #232328);
    color: var(--fg, #ececf0);
  }
  .btn.danger {
    background: var(--danger, #ff5a5a);
    border-color: var(--danger, #ff5a5a);
    color: white;
  }
</style>
