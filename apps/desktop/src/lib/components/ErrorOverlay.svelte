<script lang="ts">
  import type { BuildError } from "$lib/bundle/bundler";

  let { buildErrors = [], runtimeError }: { buildErrors?: BuildError[]; runtimeError?: { message: string; stack?: string } } = $props();
</script>

{#if buildErrors.length || runtimeError}
  <div class="overlay" role="alert">
    {#each buildErrors as e}
      <div class="err"><span class="loc">{e.file}:{e.line}:{e.column}</span> {e.message}</div>
    {/each}
    {#if runtimeError}
      <div class="err">{runtimeError.message}</div>
      {#if runtimeError.stack}<pre>{runtimeError.stack}</pre>{/if}
    {/if}
  </div>
{/if}

<style>
  .overlay { position: absolute; left: 12px; right: 12px; bottom: 12px; max-height: 50%; overflow: auto; padding: 10px 12px; border-radius: 8px; background: rgba(40, 8, 8, 0.92); color: #ffd9d9; font: 12px/1.5 ui-monospace, Menlo, monospace; }
  .loc { color: #ff8a8a; }
  pre { margin: 6px 0 0; white-space: pre-wrap; opacity: 0.75; }
</style>
