<script lang="ts">
  import type { TimelineManifest } from "liosvideo";
  import { frameAtX, isRangeSelection, rangeFor, selectionFor, spanToPx, visibleRows, type Row, type Selection } from "$lib/timeline/model";

  let {
    manifest, composition, frame, selected, onSelect, onSeek,
  }: {
    manifest: TimelineManifest; composition: string; frame: number; selected?: Selection;
    onSelect: (s: Selection) => void; onSeek: (frame: number) => void;
  } = $props();

  let expanded = $state(new Set<string>());
  let trackWidth = $state(600);
  let drag = $state<{ anchor: number; current: number } | null>(null);
  let suppressClick = false;

  const rows = $derived(visibleRows(manifest, expanded));
  const playheadX = $derived(spanToPx({ startFrame: frame, endFrame: frame }, manifest.totalFrames, trackWidth).x);

  function toggle(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded = next;
  }

  function choose(row: Row) {
    const s = selectionFor(row, composition, manifest);
    onSelect(s);
    onSeek(s.startFrame);
  }

  function seekAt(e: MouseEvent) {
    if (e.shiftKey || suppressClick) return;
    const el = e.currentTarget as HTMLElement;
    onSeek(frameAtX(e.clientX - el.getBoundingClientRect().left, el.clientWidth, manifest.totalFrames));
  }

  function trackFrame(e: PointerEvent, el: HTMLElement): number {
    return frameAtX(e.clientX - el.getBoundingClientRect().left, el.clientWidth, manifest.totalFrames);
  }

  /** Shift-drag anywhere on a track selects a time range, including across scenes. */
  function beginRange(e: PointerEvent) {
    if (!e.shiftKey || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const f = trackFrame(e, el);
    drag = { anchor: f, current: f };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }

  function moveRange(e: PointerEvent) {
    if (!drag) return;
    drag = { ...drag, current: trackFrame(e, e.currentTarget as HTMLElement) };
  }

  function endRange(e: PointerEvent) {
    if (!drag) return;
    const el = e.currentTarget as HTMLElement;
    const current = trackFrame(e, el);
    const from = Math.min(drag.anchor, current);
    const to = Math.max(drag.anchor, current);
    drag = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {}
    // the click that follows a drag would otherwise reselect the bar under the pointer
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    onSelect(rangeFor(composition, manifest, from, to));
    onSeek(from);
  }

  const dragRange = $derived(
    drag
      ? { startFrame: Math.min(drag.anchor, drag.current), endFrame: Math.max(drag.anchor, drag.current) }
      : isRangeSelection(selected)
        ? { startFrame: selected!.startFrame, endFrame: selected!.endFrame }
        : undefined,
  );

  const isSelected = (row: Row) =>
    !!selected && selected.composition === composition && selected.sceneId === row.sceneId && selected.path === row.path;
</script>

<div class="timeline">
  {#if !rows.length}
    <p class="empty">No scenes</p>
  {:else}
    {#each rows as row (row.key)}
      <div class="row" class:selected={isSelected(row)} class:scene={row.depth === 0 && !row.isAudio} class:audio={row.isAudio}>
        <div class="head" style:padding-left="{8 + row.depth * 14}px">
          {#if row.expandable}
            <button class="disclosure" aria-label="{row.expanded ? 'Collapse' : 'Expand'} {row.label}" aria-expanded={row.expanded} onclick={() => toggle(row.key)}>
              {row.expanded ? "▾" : "▸"}
            </button>
          {:else}
            <span class="disclosure"></span>
          {/if}
          <button class="label" onclick={() => choose(row)}>{row.label}</button>
        </div>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="track"
          bind:clientWidth={trackWidth}
          title="Shift-drag to select a time range"
          onclick={seekAt}
          onpointerdown={beginRange}
          onpointermove={moveRange}
          onpointerup={endRange}
          onpointercancel={() => (drag = null)}
        >
          {#each row.spans as span}
            {@const px = spanToPx(span, manifest.totalFrames, trackWidth)}
            <button
              class="bar"
              style:left="{px.x}px"
              style:width="{px.width}px"
              aria-label="{row.label} {row.isAudio ? 'audio clip' : row.depth === 0 ? 'scene' : 'animation'} {span.startFrame}–{span.endFrame}"
              onclick={(e) => {
                e.stopPropagation();
                if (suppressClick) return;
                choose(row);
              }}
            ></button>
          {/each}
          {#if dragRange}
            {@const rp = spanToPx(dragRange, manifest.totalFrames, trackWidth)}
            <div class="range" style:left="{rp.x}px" style:width="{rp.width}px"></div>
          {/if}
          <div class="playhead" style:left="{playheadX}px"></div>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .timeline { max-height: 220px; overflow-y: auto; overflow-x: hidden; border-top: 1px solid var(--border); font-size: 12px; user-select: none; min-width: 0; }
  .empty { color: var(--muted); padding: 8px 12px; margin: 0; }
  .row { display: grid; grid-template-columns: 180px 1fr; height: 24px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); min-width: 0; }
  .row.selected { background: color-mix(in srgb, #4f8cff 18%, transparent); }
  .head { display: flex; align-items: center; gap: 2px; min-width: 0; border-right: 1px solid var(--border); }
  .disclosure { width: 16px; flex-shrink: 0; border: none; background: none; color: var(--muted); cursor: pointer; padding: 0; font-size: 10px; }
  .label { flex: 1; min-width: 0; text-align: left; border: none; background: none; color: var(--fg); cursor: pointer; padding: 0 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: inherit; }
  .row.scene .label { font-weight: 600; }
  .row.audio .label { color: #34d399; font-weight: 500; }
  .row.audio .bar { background: #10b981; border: 1px solid #059669; opacity: 0.85; }
  .track { position: relative; cursor: text; }
  .bar { position: absolute; top: 5px; height: 14px; border: none; border-radius: 3px; padding: 0; background: #4f8cff; opacity: 0.75; cursor: pointer; }
  .row.scene .bar { background: var(--raised); border: 1px solid var(--border); opacity: 1; }
  .row.selected .bar { opacity: 1; outline: 1px solid #4f8cff; }
  .range { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, #4f8cff 24%, transparent); border-left: 1px solid #4f8cff; border-right: 1px solid #4f8cff; pointer-events: none; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: #ff5a5a; pointer-events: none; }
</style>
