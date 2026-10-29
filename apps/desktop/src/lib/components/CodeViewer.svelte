<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    Check,
    Code,
    Copy,
    FileCode,
    Folder,
    RefreshCw,
  } from "@lucide/svelte";

  let {
    projectRoot,
    activeComposition,
  }: {
    projectRoot?: string;
    activeComposition?: string;
  } = $props();

  let files = $state<string[]>([]);
  let selectedFile = $state<string>("");
  let codeContent = $state<string>("");
  let loadingList = $state<boolean>(true);
  let loadingFile = $state<boolean>(false);
  let error = $state<string | null>(null);
  let copied = $state<boolean>(false);

  let lines = $derived(codeContent ? codeContent.split("\n") : []);
  let lineCount = $derived(lines.length);

  export async function loadFileList() {
    loadingList = true;
    error = null;
    try {
      const list = await invoke<string[]>("list_code_files");
      files = list ?? [];
      if (!selectedFile || !files.includes(selectedFile)) {
        if (activeComposition && files.includes(activeComposition)) {
          selectedFile = activeComposition;
        } else {
          selectedFile = files[0] ?? "";
        }
      }
      if (selectedFile) {
        await selectFile(selectedFile);
      }
    } catch (e: any) {
      error = typeof e === "string" ? e : e?.message ?? "Failed to list code files";
      files = [];
    } finally {
      loadingList = false;
    }
  }

  export async function selectFile(file: string) {
    selectedFile = file;
    loadingFile = true;
    try {
      const content = await invoke<string>("read_project_file", { rel: file });
      codeContent = content;
    } catch (e: any) {
      codeContent = `// Error loading ${file}: ${e}`;
    } finally {
      loadingFile = false;
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeContent);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // ignore
    }
  }

  // React to composition switcher in main header if user changes it
  $effect(() => {
    if (activeComposition && files.includes(activeComposition) && !selectedFile.includes("scenes/")) {
      void selectFile(activeComposition);
    }
  });

  onMount(() => {
    void loadFileList();
  });
</script>

<div class="code-viewer" data-testid="code-viewer">
  <aside class="file-sidebar">
    <div class="sidebar-header">
      <Code size={14} class="sidebar-icon" />
      <span>Project Code</span>
      <button class="reload-btn" onclick={loadFileList} title="Refresh file list" disabled={loadingList}>
        <RefreshCw size={11} class={loadingList ? "spin" : ""} />
      </button>
    </div>
    <div class="file-list">
      {#if loadingList && files.length === 0}
        <div class="loading-hint">Loading files...</div>
      {:else if files.length === 0}
        <div class="empty-hint">No TypeScript files found.</div>
      {:else}
        <!-- Compositions -->
        <div class="group-label">Compositions</div>
        {#each files.filter((f) => !f.includes("/")) as file (file)}
          <button
            class="file-item"
            class:active={selectedFile === file}
            onclick={() => selectFile(file)}
          >
            <FileCode size={13} class="file-icon comp" />
            <span class="file-name">{file}</span>
          </button>
        {/each}

        <!-- Scenes -->
        {#if files.some((f) => f.startsWith("scenes/"))}
          <div class="group-label">
            <Folder size={11} />
            <span>Scenes</span>
          </div>
          {#each files.filter((f) => f.startsWith("scenes/")) as file (file)}
            <button
              class="file-item nested"
              class:active={selectedFile === file}
              onclick={() => selectFile(file)}
            >
              <FileCode size={13} class="file-icon scene" />
              <span class="file-name">{file.replace(/^scenes\//, "")}</span>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  </aside>

  <main class="code-stage">
    <div class="code-header">
      <div class="code-info">
        <span class="current-file">{selectedFile || "No file selected"}</span>
        {#if selectedFile}
          <span class="stat-badge">{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
          <span class="stat-badge">{(codeContent.length / 1024).toFixed(1)} KB</span>
        {/if}
      </div>
      <div class="code-actions">
        <button class="action-btn" onclick={copyCode} title="Copy code" disabled={!codeContent}>
          {#if copied}
            <Check size={13} color="#2e9d57" />
            <span style="color: #2e9d57">Copied!</span>
          {:else}
            <Copy size={13} />
            <span>Copy</span>
          {/if}
        </button>
        <button
          class="action-btn"
          onclick={() => selectFile(selectedFile)}
          title="Reload file"
          disabled={loadingFile || !selectedFile}
        >
          <RefreshCw size={13} class={loadingFile ? "spin" : ""} />
        </button>
      </div>
    </div>

    <div class="code-body">
      {#if loadingFile}
        <div class="loading-state">
          <RefreshCw size={20} class="spin" />
          <span>Loading {selectedFile}...</span>
        </div>
      {:else if !selectedFile}
        <div class="empty-state">
          <FileCode size={32} class="empty-icon" />
          <p>Select a file from the sidebar to view its code.</p>
        </div>
      {:else}
        <div class="editor-view">
          <div class="line-numbers" aria-hidden="true">
            {#each lines as _, idx (idx)}
              <span class="line-num">{idx + 1}</span>
            {/each}
          </div>
          <pre class="code-content"><code>{codeContent}</code></pre>
        </div>
      {/if}
    </div>
  </main>
</div>

<style>
  .code-viewer {
    display: flex;
    height: 100%;
    width: 100%;
    background: var(--panel);
    overflow: hidden;
  }

  .file-sidebar {
    width: 220px;
    background: var(--raised);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
    border-bottom: 1px solid var(--border);
  }

  :global(.sidebar-icon) {
    color: #7aa2f7;
  }

  .reload-btn {
    margin-left: auto;
    font: inherit;
    padding: 3px;
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }

  .reload-btn:hover:not(:disabled) {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }

  .file-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 12px 4px;
  }

  .file-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    font: inherit;
    font-size: 12px;
    background: transparent;
    border: none;
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .file-item:hover {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }

  .file-item.active {
    background: color-mix(in srgb, #7aa2f7 15%, transparent);
    color: #7aa2f7;
    font-weight: 500;
  }

  .file-item.nested {
    padding-left: 20px;
  }

  :global(.file-icon.comp) {
    color: #7aa2f7;
    flex-shrink: 0;
  }

  :global(.file-icon.scene) {
    color: #bb9af7;
    flex-shrink: 0;
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }

  .loading-hint,
  .empty-hint {
    padding: 12px;
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }

  .code-stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--raised);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .code-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .current-file {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
  }

  .stat-badge {
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    padding: 1px 6px;
    border-radius: 10px;
  }

  .code-actions {
    display: flex;
    align-items: center;
    gap: 6px;
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

  .code-body {
    flex: 1;
    overflow: auto;
    background: #1a1b26;
  }

  .editor-view {
    display: flex;
    min-height: 100%;
    min-width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.6;
  }

  .line-numbers {
    display: flex;
    flex-direction: column;
    padding: 16px 10px 16px 16px;
    text-align: right;
    user-select: none;
    color: #565f89;
    background: color-mix(in srgb, #1a1b26 95%, #fff);
    border-right: 1px solid color-mix(in srgb, #565f89 20%, transparent);
    flex-shrink: 0;
  }

  .line-num {
    height: 20px;
    line-height: 20px;
  }

  .code-content {
    margin: 0;
    padding: 16px;
    flex: 1;
    overflow-x: auto;
    color: #c0caf5;
    white-space: pre;
    tab-size: 2;
  }

  .code-content code {
    font: inherit;
    display: block;
    line-height: 20px;
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
  }

  :global(.empty-icon) {
    color: var(--muted);
    opacity: 0.5;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
