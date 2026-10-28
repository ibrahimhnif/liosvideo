<script lang="ts" module>
  import type { HistoryStatus } from "$lib/history/api";

  export type ProjectInfo = { root: string; compositions: string[]; history: HistoryStatus };
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { Clock, FolderOpen, FolderPlus } from "@lucide/svelte";
  import { onMount } from "svelte";
  import Logo from "./Logo.svelte";

  let { onOpen }: { onOpen: (info: ProjectInfo) => void } = $props();
  let error = $state("");
  let name = $state("");
  let recent = $state<string[]>([]);

  onMount(async () => {
    recent = await invoke<string[]>("recent_projects").catch(() => []);
  });

  async function attempt(action: () => Promise<ProjectInfo>) {
    error = "";
    try {
      onOpen(await action());
    } catch (e) {
      error = String(e);
    }
  }

  async function pick() {
    const dir = await open({ directory: true, multiple: false, title: "Open project folder" });
    if (typeof dir === "string") await attempt(() => invoke<ProjectInfo>("open_project", { root: dir }));
  }

  async function create() {
    const parent = await open({ directory: true, multiple: false, title: `Choose where to create “${name.trim()}”` });
    if (typeof parent === "string") await attempt(() => invoke<ProjectInfo>("create_project", { parent, name: name.trim() }));
  }
</script>

<div class="picker">
  <div class="hero">
    <Logo size={56} />
    <h1>Liosvideo</h1>
    <p class="tagline">Deterministic Code-First Video Engine</p>
  </div>

  <form class="new" onsubmit={(e) => (e.preventDefault(), create())}>
    <input placeholder="New project name" bind:value={name} />
    <button type="submit" disabled={!name.trim()}>
      <FolderPlus size={14} />
      <span>New project…</span>
    </button>
  </form>
  <button onclick={pick}>
    <FolderOpen size={14} />
    <span>Open folder…</span>
  </button>
  {#if recent.length}
    <div class="recent">
      <h3><Clock size={12} /> Recent</h3>
      {#each recent as root (root)}
        <button class="link" title={root} onclick={() => attempt(() => invoke<ProjectInfo>("open_project", { root }))}>
          <span class="name">{root.split("/").at(-1)}</span>
          <span class="path">{root}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .picker { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; height: 100%; padding: 24px; }
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 8px; }
  .hero h1 { margin: 12px 0 2px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--fg); }
  .tagline { margin: 0; font-size: 13px; color: var(--muted); }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  button:disabled { opacity: 0.5; cursor: default; }
  .new { display: flex; gap: 8px; }
  input { font: inherit; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); width: 220px; }
  .recent { display: flex; flex-direction: column; gap: 4px; width: min(420px, 100%); margin-top: 12px; }
  h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; display: inline-flex; align-items: center; gap: 5px; }
  .link { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; border: none; background: none; padding: 6px 8px; }
  .link:hover { background: var(--raised); }
  .name { font-weight: 500; }
  .path { color: var(--muted); font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error { color: var(--danger); max-width: 420px; text-align: center; }
</style>
