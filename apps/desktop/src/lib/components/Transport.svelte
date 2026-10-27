<script lang="ts">
  import type { SceneSpan } from "liosvideo";
  import { formatTimecode } from "$lib/preview/clock";

  let {
    frame, totalFrames, fps, playing, scenes, onToggle, onSeek,
  }: {
    frame: number; totalFrames: number; fps: number; playing: boolean; scenes: SceneSpan[];
    onToggle: () => void; onSeek: (frame: number) => void;
  } = $props();

  const last = $derived(Math.max(totalFrames - 1, 0));
</script>

<div class="transport">
  <button class="play" onclick={onToggle} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
  <span class="tc">{formatTimecode(frame, fps)}</span>
  <div class="scrub">
    <div class="markers">
      {#each scenes as s}
        <button
          class="marker"
          style:left="{(s.startFrame / Math.max(totalFrames, 1)) * 100}%"
          style:width="{((s.endFrame - s.startFrame) / Math.max(totalFrames, 1)) * 100}%"
          title={s.id}
          onclick={() => onSeek(s.startFrame)}>{s.id}</button
        >
      {/each}
    </div>
    <input type="range" min="0" max={last} value={frame} oninput={(e) => onSeek(Number(e.currentTarget.value))} aria-label="Playhead" />
  </div>
  <span class="tc muted">{formatTimecode(last, fps)}</span>
</div>

<style>
  .transport { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--border); }
  .play { width: 32px; height: 28px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  .tc { font: 12px ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .scrub { flex: 1; display: grid; gap: 2px; min-width: 0; }
  .markers { position: relative; height: 18px; }
  .marker { position: absolute; top: 0; height: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 10px; padding: 0 4px; border: 1px solid var(--border); border-radius: 3px; background: var(--raised); color: var(--muted); cursor: pointer; text-align: left; }
  input[type="range"] { width: 100%; margin: 0; }
</style>
