<script lang="ts">
  import { Palette } from "@lucide/svelte";
  import { listStyles, type StyleInfo } from "$lib/styles/api";

  let { onPick, disabled = false }: { onPick: (style: StyleInfo) => void; disabled?: boolean } = $props();
  let open = $state(false);
  let styles = $state<StyleInfo[]>([]);

  async function toggle() {
    open = !open;
    if (open && styles.length === 0) styles = await listStyles().catch(() => []);
  }

  function pick(style: StyleInfo) {
    open = false;
    onPick(style);
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="style-menu">
  <button type="button" class="style-btn" {disabled} aria-haspopup="menu" aria-expanded={open} onclick={toggle} title="Restyle in an animation style">
    <Palette size={13} />
    <span>Style</span>
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label="Animation styles">
      {#each styles as s (s.id)}
        <button type="button" role="menuitem" onclick={() => pick(s)}>{s.title}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .style-menu { position: relative; }
  .style-btn { font: inherit; font-size: 12px; padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
  .style-btn:disabled { opacity: 0.5; cursor: default; }
  .style-btn:not(:disabled):hover { border-color: var(--primary); color: var(--primary); }
  .menu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 20; min-width: 240px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; padding: 4px; border-radius: 8px; border: 1px solid var(--border); background: var(--raised); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
  .menu button { font: inherit; font-size: 12px; text-align: left; padding: 6px 10px; border: none; border-radius: 5px; background: none; color: var(--fg); cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: var(--bg); color: var(--primary); outline: none; }
</style>
