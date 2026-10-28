<script lang="ts">
  import { X } from "@lucide/svelte";
  import { selectionLabel, type Selection } from "$lib/timeline/model";

  let { selection, onClear }: { selection?: Selection; onClear: () => void } = $props();
</script>

{#if selection}
  <div class="chip" title="Attached to your next message">
    <span class="text">{selectionLabel(selection)}</span>
    <button aria-label="Clear selection" onclick={onClear}>
      <X size={12} />
    </button>
  </div>
{/if}

<style>
  .chip { display: flex; align-items: center; gap: 6px; margin: 8px 12px; padding: 4px 6px 4px 10px; border-radius: 999px; background: color-mix(in srgb, #4f8cff 16%, transparent); border: 1px solid color-mix(in srgb, #4f8cff 40%, transparent); font-size: 12px; }
  .text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  button { border: none; background: none; color: var(--muted); cursor: pointer; padding: 0 2px; display: inline-flex; align-items: center; justify-content: center; }
  button:hover { color: var(--fg); }
</style>
