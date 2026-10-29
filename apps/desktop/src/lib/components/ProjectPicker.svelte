<script lang="ts" module>
  import type { HistoryStatus } from "$lib/history/api";

  export type ProjectInfo = { root: string; compositions: string[]; history: HistoryStatus };
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { Box, Clock, FolderOpen, FolderPlus, Rocket, Smartphone, Sparkles, Terminal } from "@lucide/svelte";
  import { onMount } from "svelte";
  import Logo from "./Logo.svelte";

  let { onOpen }: { onOpen: (info: ProjectInfo) => void } = $props();
  let error = $state("");
  let name = $state("");
  let recent = $state<string[]>([]);
  let selectedTemplate = $state("blank");

  const TEMPLATES = [
    {
      id: "blank",
      title: "Blank / Custom",
      tag: "16:9 & 9:16",
      desc: "Clean minimal canvas to build from scratch",
      icon: Sparkles
    },
    {
      id: "minimal-dev",
      title: "Minimal Dev Screencast",
      tag: "16:9",
      desc: "Terminal & browser window with code spotlights",
      icon: Terminal
    },
    {
      id: "product-3d",
      title: "3D Product Showcase",
      tag: "16:9",
      desc: "Interactive Three.js 3D hero with floating specs",
      icon: Box
    },
    {
      id: "kinetic-short",
      title: "Kinetic Short",
      tag: "9:16",
      desc: "Punchy typography & phone mockup for mobile",
      icon: Smartphone
    },
    {
      id: "saas-launch",
      title: "SaaS Feature Launch",
      tag: "16:9",
      desc: "Modern app window mockup & metric callouts",
      icon: Rocket
    }
  ];

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
    if (typeof parent === "string") {
      await attempt(() =>
        invoke<ProjectInfo>("create_project", {
          parent,
          name: name.trim(),
          template: selectedTemplate
        })
      );
    }
  }
</script>

<div class="picker">
  <div class="hero">
    <Logo size={52} />
    <h1>Liosvideo</h1>
    <p class="tagline">Deterministic Code-First Video Engine</p>
  </div>

  <div class="template-section">
    <div class="template-header">
      <span class="section-title">Starter Template (Optional)</span>
    </div>
    <div class="template-grid" role="radiogroup" aria-label="Starter templates">
      {#each TEMPLATES as t (t.id)}
        {@const Icon = t.icon}
        <button
          type="button"
          class="template-card"
          class:selected={selectedTemplate === t.id}
          data-testid={`template-${t.id}`}
          role="radio"
          aria-checked={selectedTemplate === t.id}
          onclick={() => (selectedTemplate = t.id)}
        >
          <div class="card-top">
            <div class="icon-wrap">
              <Icon size={14} />
            </div>
            <span class="tag">{t.tag}</span>
          </div>
          <div class="card-body">
            <span class="title">{t.title}</span>
            <span class="desc">{t.desc}</span>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <form class="new" onsubmit={(e) => (e.preventDefault(), create())}>
    <input placeholder="New project name" bind:value={name} />
    <button type="submit" disabled={!name.trim()}>
      <FolderPlus size={14} />
      <span>New project…</span>
    </button>
  </form>
  <button class="open-btn" onclick={pick}>
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
  .picker { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 100%; padding: 24px; max-width: 680px; margin: 0 auto; }
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 4px; }
  .hero h1 { margin: 10px 0 2px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--fg); }
  .tagline { margin: 0; font-size: 13px; color: var(--muted); }

  .template-section { width: 100%; display: flex; flex-direction: column; gap: 8px; margin: 4px 0 6px; }
  .template-header { display: flex; justify-content: space-between; align-items: center; }
  .section-title { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; font-weight: 600; }
  .template-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; width: 100%; }

  .template-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }
  .template-card:hover { border-color: var(--primary); background: var(--raised); }
  .template-card.selected {
    border-color: var(--primary);
    background: rgba(122, 162, 247, 0.08);
    box-shadow: 0 0 0 1px var(--primary);
  }

  .card-top { display: flex; align-items: center; justify-content: space-between; width: 100%; }
  .icon-wrap { color: var(--primary); display: flex; align-items: center; }
  .tag { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: var(--raised); color: var(--muted); letter-spacing: 0.02em; }
  .card-body { display: flex; flex-direction: column; gap: 2px; }
  .title { font-size: 12px; font-weight: 600; color: var(--fg); line-height: 1.3; }
  .desc { font-size: 11px; color: var(--muted); line-height: 1.3; }

  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  button:disabled { opacity: 0.5; cursor: default; }
  .open-btn { width: 100%; max-width: 380px; }
  .new { display: flex; gap: 8px; width: 100%; max-width: 380px; justify-content: center; }
  input { font: inherit; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); flex: 1; }
  .recent { display: flex; flex-direction: column; gap: 4px; width: min(420px, 100%); margin-top: 8px; }
  h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; display: inline-flex; align-items: center; gap: 5px; }
  .link { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; border: none; background: none; padding: 6px 8px; }
  .link:hover { background: var(--raised); }
  .name { font-weight: 500; }
  .path { color: var(--muted); font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error { color: var(--danger); max-width: 420px; text-align: center; }
</style>
