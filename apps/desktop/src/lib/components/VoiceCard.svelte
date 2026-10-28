<script lang="ts">
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { Mic, Pause, Play, Square, Volume2 } from "@lucide/svelte";
  import { VoiceRecorder } from "$lib/audio/recorder";

  let {
    lineId,
    text = "",
    audioPath = "",
    onRecorded,
  }: {
    lineId: string;
    text?: string;
    audioPath?: string;
    onRecorded?: (path: string) => void;
  } = $props();

  let recorder = new VoiceRecorder();
  let isRecording = $state(false);
  let recordSeconds = $state(0);
  let timer: any = null;
  let currentAudioUrl = $state("");
  let isPlaying = $state(false);
  let audioEl = $state<HTMLAudioElement | null>(null);

  $effect(() => {
    if (audioPath) {
      invoke<string>("asset_url_path", { rel: audioPath })
        .then((path) => {
          currentAudioUrl = convertFileSrc(path);
        })
        .catch(() => {});
    }
  });

  async function toggleRecord() {
    if (!isRecording) {
      try {
        await recorder.start();
        isRecording = true;
        recordSeconds = 0;
        timer = setInterval(() => {
          recordSeconds++;
        }, 1000);
      } catch (err) {
        console.error("Failed to start recording:", err);
      }
    } else {
      clearInterval(timer);
      isRecording = false;
      try {
        const { blob, duration } = await recorder.stop();
        const arrayBuf = await blob.arrayBuffer();
        const savedRelPath = await invoke<string>("save_voice_recording", {
          lineId,
          duration,
          bytes: Array.from(new Uint8Array(arrayBuf)),
        });
        currentAudioUrl = URL.createObjectURL(blob);
        onRecorded?.(savedRelPath);
      } catch (err) {
        console.error("Failed to save recording:", err);
      }
    }
  }

  function togglePlay() {
    if (!audioEl) return;
    if (isPlaying) {
      audioEl.pause();
      isPlaying = false;
    } else {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
      isPlaying = true;
    }
  }
</script>

<div class="voice-card">
  <div class="header">
    <span class="badge"><Volume2 size={10} /> Voice Line</span>
    <span class="line-id">{lineId}</span>
  </div>

  {#if text}
    <p class="script-text">"{text}"</p>
  {/if}

  {#if currentAudioUrl}
    <!-- svelte-ignore a11y_media_has_caption -->
    <audio bind:this={audioEl} src={currentAudioUrl} onended={() => (isPlaying = false)}></audio>
  {/if}

  <div class="actions">
    {#if currentAudioUrl}
      <button class="btn play" onclick={togglePlay} aria-label={isPlaying ? "Pause audio" : "Play audio"}>
        {#if isPlaying}
          <Pause size={12} fill="currentColor" />
          <span>Pause</span>
        {:else}
          <Play size={12} fill="currentColor" />
          <span>Listen</span>
        {/if}
      </button>
    {/if}

    <button class="btn record" class:recording={isRecording} onclick={toggleRecord}>
      {#if isRecording}
        <Square size={12} fill="currentColor" />
        <span>Stop & Save (00:{recordSeconds.toString().padStart(2, "0")})</span>
      {:else}
        <Mic size={12} />
        <span>Record Take</span>
      {/if}
    </button>
  </div>
</div>

<style>
  .voice-card {
    background: var(--raised, #232328);
    border: 1px solid var(--border, #2e2e34);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0;
    font-size: 13px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    background: #3b82f6;
    color: white;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .line-id {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--muted, #8d8d98);
  }
  .script-text {
    margin: 0;
    font-style: italic;
    color: var(--fg, #ececf0);
    line-height: 1.4;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .btn {
    border: 1px solid var(--border, #2e2e34);
    background: var(--panel, #18181b);
    color: var(--fg, #ececf0);
    border-radius: 5px;
    padding: 4px 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn.record.recording {
    background: #ef4444;
    border-color: #ef4444;
    color: white;
  }
</style>
