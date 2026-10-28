<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import {
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle2,
    Loader2,
    RefreshCw,
    X,
  } from "@lucide/svelte";

  export type SceneValidationIssue = {
    severity: "error" | "warning";
    message: string;
    line?: number;
  };

  export type SceneValidationResult = {
    file: string;
    sceneId?: string;
    valid: boolean;
    issues: SceneValidationIssue[];
  };

  let {
    open = false,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let loading = $state(false);
  let results = $state<SceneValidationResult[]>([]);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open) {
      runValidation();
    }
  });

  async function runValidation() {
    loading = true;
    error = null;
    try {
      results = await invoke<SceneValidationResult[]>("validate_scenes", {});
    } catch (e) {
      error = String(e);
      results = [];
    } finally {
      loading = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      onClose();
    }
  }

  const allValid = $derived(results.length > 0 && results.every((r) => r.valid));
  const totalErrors = $derived(
    results.reduce((acc, r) => acc + r.issues.filter((i) => i.severity === "error").length, 0),
  );
  const totalWarnings = $derived(
    results.reduce((acc, r) => acc + r.issues.filter((i) => i.severity === "warning").length, 0),
  );
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose()} data-testid="validation-modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="validation-title">
      <div class="header">
        <div class="header-left">
          <h2 id="validation-title">Scene Code Validator</h2>
          {#if !loading && results.length > 0}
            <span class="status-pill" class:success={allValid} class:failure={!allValid}>
              {#if allValid}
                <CheckCircle2 size={13} />
                <span>All Scenes Valid</span>
              {:else}
                <AlertTriangle size={13} />
                <span>{totalErrors} Errors, {totalWarnings} Warnings</span>
              {/if}
            </span>
          {/if}
        </div>
        <div class="header-actions">
          <button class="btn-secondary" onclick={runValidation} disabled={loading} title="Re-run scene validation">
            {#if loading}
              <Loader2 size={13} class="spin" />
              <span>Validating...</span>
            {:else}
              <RefreshCw size={13} />
              <span>Re-validate</span>
            {/if}
          </button>
          <button class="close-btn" onclick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>
      </div>

      <div class="content">
        <p class="description">
          Validates that your scene modules adhere to liosvideo's deterministic WebGPU rendering constraints,
          proper export structure, pure timing rules, and valid asset references.
        </p>

        {#if error}
          <div class="alert error">
            Failed to run validation: {error}
          </div>
        {/if}

        {#if loading}
          <div class="loading-state">
            <Loader2 size={16} class="spin" />
            <span>Checking scene files...</span>
          </div>
        {:else if results.length === 0}
          <div class="empty-state">
            No scene files (*.ts) found under <code>scenes/</code> directory.
          </div>
        {:else}
          <div class="scene-list">
            {#each results as r (r.file)}
              <div class="scene-card" class:invalid={!r.valid}>
                <div class="card-header">
                  <div class="card-title">
                    <span class="file-name">{r.file}</span>
                    {#if r.sceneId}
                      <span class="scene-badge">ID: {r.sceneId}</span>
                    {/if}
                  </div>
                  <span class="file-status" class:pass={r.valid} class:fail={!r.valid}>
                    {#if r.valid}
                      <CheckCircle2 size={12} />
                      <span>Pass</span>
                    {:else}
                      <AlertCircle size={12} />
                      <span>Issues</span>
                    {/if}
                  </span>
                </div>

                {#if r.issues.length > 0}
                  <div class="issues-list">
                    {#each r.issues as issue}
                      <div class="issue-item {issue.severity}">
                        <span class="issue-icon">
                          {#if issue.severity === "error"}
                            <AlertCircle size={14} />
                          {:else}
                            <AlertTriangle size={14} />
                          {/if}
                        </span>
                        <div class="issue-body">
                          {#if issue.line}
                            <span class="line-badge">Line {issue.line}</span>
                          {/if}
                          <span class="issue-message">{issue.message}</span>
                        </div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="clean-note">
                    <Check size={13} />
                    <span>Fully deterministic, valid imports, and correct scene export structure.</span>
                  </p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="footer">
        <button class="done-btn" onclick={onClose}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 620px;
    max-width: calc(100vw - 32px);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .status-pill.success {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }
  .status-pill.failure {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .btn-secondary {
    font: inherit;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--fg);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .close-btn:hover {
    color: var(--fg);
    background: var(--raised);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .description {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }

  .alert {
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 12px;
  }
  .alert.error {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .loading-state, .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }

  .scene-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .scene-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--raised);
    overflow: hidden;
  }
  .scene-card.invalid {
    border-color: rgba(239, 68, 68, 0.4);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-name {
    font-weight: 600;
    font-family: monospace;
    font-size: 12px;
  }

  .scene-badge {
    font-size: 10px;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--muted);
  }

  .file-status {
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .file-status.pass {
    color: #22c55e;
  }
  .file-status.fail {
    color: #ef4444;
  }

  .issues-list {
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .issue-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
  }

  .issue-icon {
    display: inline-flex;
    align-items: center;
    margin-top: 1px;
  }

  .issue-body {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }

  .line-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--border);
    color: var(--fg);
  }

  .issue-item.error .issue-message {
    color: #ef4444;
  }

  .issue-item.warning .issue-message {
    color: #f59e0b;
  }

  .clean-note {
    margin: 0;
    padding: 10px 14px;
    font-size: 12px;
    color: #22c55e;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid var(--border);
  }

  .done-btn {
    font: inherit;
    font-weight: 500;
    padding: 6px 16px;
    border-radius: 6px;
    border: none;
    background: #4f8cff;
    color: white;
    cursor: pointer;
  }
  .done-btn:hover {
    background: #3b76e1;
  }
</style>
