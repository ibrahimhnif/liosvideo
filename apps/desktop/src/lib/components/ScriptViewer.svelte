<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    Clock,
    Copy,
    Check,
    FileText,
    Mic,
    RefreshCw,
    Sparkles,
  } from "@lucide/svelte";
  import Markdown from "./Markdown.svelte";

  let { projectRoot }: { projectRoot?: string } = $props();

  let content = $state<string>("");
  let loading = $state<boolean>(true);
  let error = $state<string | null>(null);
  let copied = $state<boolean>(false);
  let viewMode = $state<"formatted" | "raw">("formatted");
  let voTimings = $state<Record<string, { duration?: number; words?: any[] }>>({});

  type VoLine = {
    id: string;
    text: string;
    duration?: number;
    hasAudio: boolean;
  };

  let parsedVoLines = $derived.by(() => {
    if (!content) return [];
    const lines = content.split("\n");
    const result: VoLine[] = [];
    let currentId: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/<!--\s*vo:([a-zA-Z0-9_-]+)\s*-->/);
      if (match) {
        currentId = match[1];
      } else if (currentId && line.length > 0 && !line.startsWith("#") && !line.startsWith("\x3c!--")) {
        const timing = voTimings[currentId];
        result.push({
          id: currentId,
          text: line,
          duration: timing?.duration,
          hasAudio: !!timing,
        });
        currentId = null;
      }
    }
    return result;
  });

  let wordCount = $derived.by(() => {
    if (!content) return 0;
    const clean = content.replace(/<!--[\s\S]*?-->/g, "").replace(/#+\s+/g, "");
    return clean.trim().split(/\s+/).filter(Boolean).length;
  });

  let estimatedDuration = $derived.by(() => {
    // Average 150 words per minute speaking rate
    const minutes = wordCount / 150;
    return Math.round(minutes * 60);
  });

  let totalVoAudioDuration = $derived.by(() => {
    return parsedVoLines.reduce((acc, l) => acc + (l.duration ?? 0), 0);
  });

  export async function loadScript() {
    loading = true;
    error = null;
    try {
      const text = await invoke<string>("read_project_file", { rel: "script.md" });
      content = text;
      try {
        const timings = await invoke<Record<string, any>>("get_vo_timings", {
          root: projectRoot ?? null,
        });
        voTimings = timings ?? {};
      } catch {
        voTimings = {};
      }
    } catch (e: any) {
      error = typeof e === "string" ? e : e?.message ?? "Failed to read script.md";
      content = "";
    } finally {
      loading = false;
    }
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // ignore
    }
  }

  onMount(() => {
    void loadScript();
  });
</script>

<div class="script-viewer" data-testid="script-viewer">
  <div class="toolbar">
    <div class="toolbar-left">
      <FileText size={15} class="icon-file" />
      <span class="file-name">script.md</span>
      <div class="stats-pills">
        <span class="pill" title="Total word count">
          {wordCount} words
        </span>
        <span class="pill" title="Estimated voiceover duration">
          <Clock size={11} />
          {#if totalVoAudioDuration > 0}
            {totalVoAudioDuration.toFixed(1)}s audio
          {:else}
            ~{estimatedDuration}s speech
          {/if}
        </span>
        {#if parsedVoLines.length > 0}
          <span class="pill vo-pill" title="Voiceover lines">
            <Mic size={11} />
            {parsedVoLines.length} VO {parsedVoLines.length === 1 ? "line" : "lines"}
          </span>
        {/if}
      </div>
    </div>
    <div class="toolbar-right">
      <div class="mode-switch">
        <button
          class="switch-btn"
          class:active={viewMode === "formatted"}
          onclick={() => (viewMode = "formatted")}
        >
          Formatted
        </button>
        <button
          class="switch-btn"
          class:active={viewMode === "raw"}
          onclick={() => (viewMode = "raw")}
        >
          Raw
        </button>
      </div>
      <button class="action-btn" onclick={copyScript} title="Copy script markdown">
        {#if copied}
          <Check size={13} color="#2e9d57" />
          <span style="color: #2e9d57">Copied!</span>
        {:else}
          <Copy size={13} />
          <span>Copy</span>
        {/if}
      </button>
      <button class="action-btn" onclick={loadScript} title="Reload script from disk" disabled={loading}>
        <RefreshCw size={13} class={loading ? "spin" : ""} />
      </button>
    </div>
  </div>

  <div class="content-container">
    {#if loading && !content}
      <div class="loading-state">
        <RefreshCw size={20} class="spin" />
        <span>Loading script...</span>
      </div>
    {:else if error}
      <div class="empty-state">
        <FileText size={32} class="empty-icon" />
        <h3>No script.md found</h3>
        <p>This project does not have a <code>script.md</code> file yet.</p>
        <p class="hint">Ask the AI agent in the chat to research and generate a narration script!</p>
      </div>
    {:else if viewMode === "raw"}
      <pre class="raw-view"><code>{content}</code></pre>
    {:else}
      <div class="formatted-view">
        {#if parsedVoLines.length > 0}
          <div class="vo-overview">
            <div class="vo-overview-title">
              <Sparkles size={13} />
              <span>Voiceover Lines</span>
            </div>
            <div class="vo-grid">
              {#each parsedVoLines as line (line.id)}
                <div class="vo-card">
                  <div class="vo-card-top">
                    <span class="vo-id-badge">
                      <Mic size={10} />
                      {line.id}
                    </span>
                    {#if line.duration != null}
                      <span class="vo-duration-badge">{line.duration.toFixed(2)}s</span>
                    {/if}
                  </div>
                  <div class="vo-card-text">"{line.text}"</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="markdown-body">
          <Markdown {content} />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .script-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--panel);
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--raised);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 12px;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  :global(.icon-file) {
    color: #7aa2f7;
    flex-shrink: 0;
  }

  .file-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--fg);
    font-family: ui-monospace, monospace;
  }

  .stats-pills {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    padding: 2px 7px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .vo-pill {
    color: #bb9af7;
    background: color-mix(in srgb, #bb9af7 12%, transparent);
    border-color: color-mix(in srgb, #bb9af7 30%, transparent);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mode-switch {
    display: flex;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
  }

  .switch-btn {
    font: inherit;
    font-size: 11px;
    padding: 2px 8px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .switch-btn.active {
    background: var(--raised);
    color: var(--fg);
    font-weight: 500;
  }

  .action-btn {
    font: inherit;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--fg);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .action-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--fg) 6%, var(--panel));
    border-color: color-mix(in srgb, var(--fg) 20%, transparent);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted);
    gap: 8px;
    text-align: center;
  }

  :global(.empty-icon) {
    color: var(--muted);
    opacity: 0.5;
    margin-bottom: 8px;
  }

  .empty-state h3 {
    margin: 0;
    font-size: 16px;
    color: var(--fg);
  }

  .empty-state p {
    margin: 2px 0;
    font-size: 13px;
  }

  .empty-state .hint {
    color: #7aa2f7;
    margin-top: 8px;
  }

  .raw-view {
    margin: 0;
    padding: 16px;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .formatted-view {
    max-width: 860px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .vo-overview {
    background: color-mix(in srgb, #bb9af7 7%, var(--raised));
    border: 1px solid color-mix(in srgb, #bb9af7 25%, transparent);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .vo-overview-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #bb9af7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .vo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
  }

  .vo-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .vo-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .vo-id-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: #7aa2f7;
    background: color-mix(in srgb, #7aa2f7 10%, transparent);
    padding: 1px 5px;
    border-radius: 4px;
  }

  .vo-duration-badge {
    font-size: 10px;
    color: #2e9d57;
    font-family: ui-monospace, monospace;
  }

  .vo-card-text {
    font-size: 12px;
    line-height: 1.4;
    color: var(--fg);
    font-style: italic;
  }

  .markdown-body {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px 32px;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
