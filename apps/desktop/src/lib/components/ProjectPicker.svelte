<script lang="ts" module>
  export type ProjectInfo = { root: string; compositions: string[] };
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";

  let { onOpen }: { onOpen: (info: ProjectInfo) => void } = $props();
  let error = $state("");

  async function pick() {
    error = "";
    const dir = await open({ directory: true, multiple: false, title: "Open project folder" });
    if (typeof dir !== "string") return;
    try {
      onOpen(await invoke<ProjectInfo>("open_project", { root: dir }));
    } catch (e) {
      error = String(e);
    }
  }
</script>

<div class="picker">
  <button onclick={pick}>Open project folder…</button>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .picker { display: grid; place-items: center; gap: 12px; height: 100%; }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  .error { color: var(--danger); }
</style>
