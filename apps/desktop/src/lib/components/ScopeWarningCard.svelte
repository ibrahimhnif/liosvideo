<script lang="ts">
  import { AlertTriangle, Undo2, X } from "@lucide/svelte";

  let {
    files,
    onRevert,
    onDismiss,
  }: {
    files: string[];
    onRevert?: () => void;
    onDismiss?: () => void;
  } = $props();

  let reverting = $state(false);

  async function handleRevert() {
    if (!onRevert || reverting) return;
    reverting = true;
    try {
      await onRevert();
    } finally {
      reverting = false;
    }
  }
</script>

<div class="scope-warning-card" data-testid="scope-warning-card">
  <div class="header">
    <AlertTriangle size={15} color="#fbbf24" />
    <span class="title">Out-of-Scope Files Modified</span>
    {#if onDismiss}
      <button class="dismiss-btn" onclick={onDismiss} title="Dismiss warning" aria-label="Dismiss warning">
        <X size={14} />
      </button>
    {/if}
  </div>
  <p class="description">
    The agent made changes to files outside the currently selected scene/composition:
  </p>
  <ul class="file-list">
    {#each files as file}
      <li class="file-item"><code>{file}</code></li>
    {/each}
  </ul>
  {#if onRevert}
    <div class="actions">
      <button
        class="revert-btn"
        disabled={reverting}
        onclick={handleRevert}
      >
        <Undo2 size={13} />
        <span>{reverting ? "Reverting..." : "Revert Out-of-Scope Files"}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .scope-warning-card {
    background: #2a1f10;
    border: 1px solid #d97706;
    border-radius: 8px;
    padding: 12px;
    margin: 8px 0;
    color: #fef3c7;
    font-size: 13px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-bottom: 6px;
  }

  .title {
    flex: 1;
    color: #fbbf24;
  }

  .dismiss-btn {
    background: transparent;
    border: none;
    color: #fef3c7;
    cursor: pointer;
    padding: 2px;
    opacity: 0.7;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .dismiss-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.1);
  }

  .description {
    margin: 0 0 6px 0;
    font-size: 12px;
    color: #fde68a;
  }

  .file-list {
    margin: 0 0 10px 0;
    padding-left: 20px;
    font-size: 12px;
  }

  .file-item code {
    background: rgba(0, 0, 0, 0.3);
    padding: 2px 5px;
    border-radius: 4px;
    color: #fde047;
    font-family: ui-monospace, monospace;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  .revert-btn {
    background: #b45309;
    border: none;
    border-radius: 6px;
    color: #ffffff;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .revert-btn:hover:not(:disabled) {
    background: #d97706;
  }

  .revert-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
