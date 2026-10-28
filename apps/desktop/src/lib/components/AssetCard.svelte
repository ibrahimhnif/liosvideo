<script lang="ts">
  import { CheckCircle2, FileUp, SkipForward } from "@lucide/svelte";
  import type { ChatItem } from "$lib/chat/reduce";
  import { open } from "@tauri-apps/plugin-dialog";

  let {
    item,
    onResolve,
  }: {
    item: Extract<ChatItem, { kind: "asset" }>;
    onResolve: (requestId: string, filePath?: string | null) => void;
  } = $props();

  let isDragging = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  const answered = $derived(item.answer !== undefined);

  async function chooseFile() {
    if (answered) return;
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Select ${item.assetKind} for ${item.assetId}`,
      });
      if (typeof selected === "string") {
        onResolve(item.requestId, selected);
      }
    } catch {
      // Fallback to HTML input if plugin is unavailable (e.g. web/test)
      fileInput?.click();
    }
  }

  function handleFileInput(e: Event) {
    if (answered) return;
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      // In Tauri / webkit environment, file objects often have a `path` property
      const path = (file as any).path || file.name;
      onResolve(item.requestId, path);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (answered) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const path = (file as any).path || file.name;
      onResolve(item.requestId, path);
    }
  }

  function skip() {
    if (answered) return;
    onResolve(item.requestId, null);
  }
</script>

<div class="card" class:answered class:dragging={isDragging}>
  <div class="header">
    <span class="badge {item.assetKind}">{item.assetKind}</span>
    <span class="asset-id">{item.assetId}</span>
  </div>
  <div class="description">{item.description}</div>

  <div
    class="dropzone"
    class:disabled={answered}
    ondragover={(e) => { e.preventDefault(); if (!answered) isDragging = true; }}
    ondragleave={() => { isDragging = false; }}
    ondrop={handleDrop}
    role="region"
    aria-label="File drop zone"
  >
    <div class="actions">
      <button class="choose" disabled={answered} onclick={chooseFile}>
        <FileUp size={12} />
        <span>Choose File</span>
      </button>
      <button class="skip" disabled={answered} onclick={skip}>
        <SkipForward size={12} />
        <span>Skip</span>
      </button>
      <input
        type="file"
        bind:this={fileInput}
        style="display: none"
        onchange={handleFileInput}
      />
    </div>
  </div>

  {#if item.answer === "provided"}
    <div class="status provided">
      <CheckCircle2 size={12} />
      <span>Provided: {item.filePath ?? item.assetId}</span>
    </div>
  {:else if item.answer === "skipped"}
    <div class="status skipped">
      <SkipForward size={12} />
      <span>Skipped</span>
    </div>
  {:else if item.answer === "cancelled"}
    <div class="status cancelled">Cancelled</div>
  {/if}
</div>

<style>
  .card {
    border: 1px solid color-mix(in srgb, #4f8cff 50%, var(--border));
    background: color-mix(in srgb, #4f8cff 6%, var(--panel));
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card.answered {
    opacity: 0.7;
  }
  .card.dragging {
    border-color: #4f8cff;
    background: color-mix(in srgb, #4f8cff 12%, var(--panel));
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .badge {
    text-transform: uppercase;
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, #4f8cff 20%, var(--raised));
    color: #4f8cff;
  }
  .badge.image { color: #2e9d57; background: color-mix(in srgb, #2e9d57 15%, var(--raised)); }
  .badge.audio { color: #a371f7; background: color-mix(in srgb, #a371f7 15%, var(--raised)); }
  .badge.video { color: #f0883e; background: color-mix(in srgb, #f0883e 15%, var(--raised)); }
  .badge.font { color: #e0a100; background: color-mix(in srgb, #e0a100 15%, var(--raised)); }
  .asset-id {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg);
  }
  .description {
    font-size: 12px;
    color: var(--fg);
    word-break: break-word;
  }
  .dropzone {
    border: 1px dashed color-mix(in srgb, #4f8cff 35%, var(--border));
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dropzone.disabled {
    border-color: var(--border);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  button {
    font: inherit;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--fg);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  button.choose {
    background: color-mix(in srgb, #4f8cff 18%, var(--raised));
    border-color: color-mix(in srgb, #4f8cff 40%, var(--border));
  }
  button.skip {
    color: var(--muted);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .status {
    font-size: 11px;
    margin-top: 2px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .status.provided {
    color: #2e9d57;
  }
  .status.skipped, .status.cancelled {
    color: var(--muted);
  }
</style>
