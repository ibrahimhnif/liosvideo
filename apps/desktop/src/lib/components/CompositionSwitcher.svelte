<script lang="ts">
  let { compositions, selected, onSelect }: { compositions: string[]; selected: string; onSelect: (c: string) => void } = $props();
</script>

<div class="switcher" role="tablist">
  {#each compositions as c}
    <button role="tab" aria-selected={c === selected} class:active={c === selected} onclick={() => onSelect(c)}>{c}</button>
  {/each}
</div>

<style>
  .switcher { display: flex; gap: 4px; }
  button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 5px; border: 1px solid transparent; background: none; color: var(--muted); cursor: pointer; }
  button.active { background: var(--raised); color: var(--fg); border-color: var(--border); }
</style>
