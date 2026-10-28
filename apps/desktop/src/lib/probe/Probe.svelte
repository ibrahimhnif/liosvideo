<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Cpu,
    Loader2,
    RefreshCw,
  } from "@lucide/svelte";
  import { blockingFailures, probeCapabilities, type Capabilities } from "./capabilities";

  let caps = $state<Capabilities | null>(null);
  let probing = $state(false);

  async function runProbe() {
    probing = true;
    try {
      caps = await probeCapabilities();
      const line = `capabilities ${JSON.stringify(caps)} ua=${navigator.userAgent}`;
      console.log(line);
      invoke("dev_log", { message: line }).catch(() => {});
    } finally {
      probing = false;
    }
  }

  onMount(() => {
    runProbe();
  });

  const capabilityLabels: Record<keyof Capabilities, { title: string; desc: string }> = {
    webgpu: {
      title: "WebGPU (Main Thread)",
      desc: "Hardware-accelerated shader and canvas rendering",
    },
    webgpuInWorker: {
      title: "WebGPU in Web Worker",
      desc: "Isolated background rendering without UI thread blocking",
    },
    offscreen2dInWorker: {
      title: "OffscreenCanvas 2D in Worker",
      desc: "Vector, text, and SVG rendering in the worker thread",
    },
    systemFontInWorker: {
      title: "System Font Access in Worker",
      desc: "Native typography and local font glyph measurement",
    },
    videoEncoderH264: {
      title: "WebCodecs VideoEncoder (H.264)",
      desc: "Hardware-accelerated MP4 video export pipeline",
    },
    videoDecoderH264: {
      title: "WebCodecs VideoDecoder (H.264)",
      desc: "Real-time frame decoding for external video assets",
    },
    audioEncoderAAC: {
      title: "WebCodecs AudioEncoder (AAC)",
      desc: "Multi-track audio mixdown and soundtrack encoding",
    },
  };
</script>

<div class="probe-container">
  <div class="probe-header">
    <div class="probe-title-row">
      <div class="probe-title">
        <Cpu size={16} />
        <span>Hardware & Engine Compatibility</span>
      </div>
      <button class="btn-refresh" onclick={runProbe} disabled={probing} title="Re-run capability probe">
        {#if probing}
          <Loader2 size={12} class="spin" />
          <span>Probing…</span>
        {:else}
          <RefreshCw size={12} />
          <span>Re-probe</span>
        {/if}
      </button>
    </div>
    <p class="probe-desc">
      Diagnostics check for WebGPU shaders, WebCodecs hardware encoding, and Web Worker isolation required by Liosvideo.
    </p>
  </div>

  {#if probing && !caps}
    <div class="probe-loading">
      <Loader2 size={18} class="spin" />
      <span>Probing system graphics & codec capabilities…</span>
    </div>
  {:else if caps}
    {#if blockingFailures(caps).length > 0}
      <div class="blocking-alert">
        <AlertTriangle size={16} />
        <div class="alert-content">
          <strong>Missing Critical Capabilities</strong>
          <span>The following required features are unavailable on this device: {blockingFailures(caps).join(", ")}. Real-time rendering may fail or degrade.</span>
        </div>
      </div>
    {/if}

    <div class="capabilities-table">
      {#each Object.entries(caps) as [name, ok] (name)}
        {@const key = name as keyof Capabilities}
        {@const info = capabilityLabels[key]}
        <div class="cap-row" class:unsupported={!ok}>
          <div class="cap-info">
            <span class="cap-name">{info?.title ?? name}</span>
            {#if info?.desc}
              <span class="cap-desc">{info.desc}</span>
            {/if}
          </div>
          <div class="cap-badge" class:supported={ok} class:unsupported={!ok}>
            {#if ok}
              <CheckCircle2 size={12} />
              <span>Supported</span>
            {:else}
              <AlertCircle size={12} />
              <span>Not Supported</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .probe-container {
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
  }

  .probe-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .probe-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .probe-title {
    font-weight: 600;
    color: var(--fg);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
  }

  .probe-desc {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.4;
  }

  .btn-refresh {
    font: inherit;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--fg);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .btn-refresh:hover:not(:disabled) {
    background: var(--bg);
  }

  .probe-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--muted);
    font-size: 12px;
  }

  .blocking-alert {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 6px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #ef4444;
    font-size: 12px;
    line-height: 1.4;
  }
  .alert-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .capabilities-table {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--raised);
    overflow: hidden;
    padding: 6px;
  }

  .cap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .cap-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cap-name {
    font-weight: 500;
    font-size: 12px;
    color: var(--fg);
  }

  .cap-desc {
    font-size: 11px;
    color: var(--muted);
  }

  .cap-badge {
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .cap-badge.supported {
    background: rgba(46, 160, 67, 0.15);
    border: 1px solid rgba(46, 160, 67, 0.3);
    color: #3fb950;
  }

  .cap-badge.unsupported {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
