<script lang="ts">
  import { onMount } from "svelte";
  import { Download, RotateCw, X } from "@lucide/svelte";
  import type { UpdateApi, UpdateInfo } from "$lib/update/api";

  let {
    api,
    /** How often to look again while the app stays open. */
    recheckMs = 6 * 60 * 60 * 1000,
  }: { api: UpdateApi; recheckMs?: number } = $props();

  type Phase = "idle" | "available" | "installing" | "installed" | "error";
  let phase = $state<Phase>("idle");
  let info = $state<UpdateInfo | null>(null);
  let progress = $state<number | null>(null);
  let error = $state("");
  let dismissed = $state(false);

  async function look() {
    if (phase === "installing" || phase === "installed") return;
    try {
      const found = await api.check();
      if (found) {
        info = found;
        phase = "available";
      }
    } catch {
      // offline or GitHub unreachable: try again on the next check, no banner
    }
  }

  async function install() {
    phase = "installing";
    progress = null;
    error = "";
    try {
      await api.install((p) => (progress = p));
      phase = "installed";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      phase = "error";
    }
  }

  onMount(() => {
    void look();
    const timer = setInterval(() => void look(), recheckMs);
    return () => clearInterval(timer);
  });
</script>

{#if info && phase !== "idle" && !(dismissed && phase === "available")}
  <div class="update-banner" data-testid="update-banner" role="status">
    {#if phase === "available"}
      <div class="text">
        <strong>Liosvideo {info.version} is available</strong>
        <span class="sub">You have {info.currentVersion}</span>
      </div>
      <div class="actions">
        <button class="primary" onclick={install}><Download size={13} /> Update now</button>
        <button class="ghost" onclick={() => (dismissed = true)}>Later</button>
      </div>
    {:else if phase === "installing"}
      <div class="text">
        <strong>Downloading {info.version}…</strong>
        <div class="bar" aria-label="Download progress">
          <div class="fill" class:indeterminate={progress === null} style="width: {Math.round((progress ?? 0.3) * 100)}%"></div>
        </div>
      </div>
    {:else if phase === "installed"}
      <div class="text">
        <strong>Update installed</strong>
        <span class="sub">Restart to use {info.version}. Save your work first.</span>
      </div>
      <div class="actions">
        <button class="primary" onclick={() => api.restart()}><RotateCw size={13} /> Restart</button>
      </div>
    {:else if phase === "error"}
      <div class="text">
        <strong>Update failed</strong>
        <span class="sub error">{error}</span>
      </div>
      <div class="actions">
        <button class="primary" onclick={install}>Try again</button>
        <button class="ghost icon" aria-label="Close" onclick={() => (phase = "available", dismissed = true)}><X size={13} /></button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    width: min(340px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid #1e3a5f;
    background: #0f1b2d;
    color: #dbeafe;
    font-size: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sub {
    opacity: 0.75;
  }
  .sub.error {
    color: #fca5a5;
    opacity: 1;
    word-break: break-word;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .primary {
    background: #2563eb;
    color: white;
  }
  .primary:hover {
    background: #1d4ed8;
  }
  .ghost {
    background: transparent;
    color: inherit;
    border-color: #1e3a5f;
  }
  .ghost.icon {
    margin-left: auto;
    padding: 5px;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: #1e3a5f;
    overflow: hidden;
    margin-top: 4px;
  }
  .fill {
    height: 100%;
    background: #60a5fa;
    transition: width 0.2s ease;
  }
  .fill.indeterminate {
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
</style>
