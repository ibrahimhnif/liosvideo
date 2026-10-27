<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import CompositionSwitcher from "$lib/components/CompositionSwitcher.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import ProjectPicker, { type ProjectInfo } from "$lib/components/ProjectPicker.svelte";
  import Probe from "$lib/probe/Probe.svelte";

  let project = $state<ProjectInfo | null>(null);
  let entry = $state("");
  let showProbe = $state(false);

  function opened(info: ProjectInfo) {
    project = info;
    entry = info.compositions.includes("long.ts") ? "long.ts" : (info.compositions[0] ?? "");
  }

  onMount(async () => {
    const root = await invoke<string | null>("initial_project");
    if (root) opened(await invoke<ProjectInfo>("open_project", { root }));
  });

  async function refreshCompositions() {
    if (!project) return;
    const compositions = await invoke<string[]>("list_compositions");
    project = { ...project, compositions };
    if (!compositions.includes(entry)) entry = compositions[0] ?? "";
  }
</script>

<main>
  <section class="chat">
    <header>liosvideo</header>
    <p class="placeholder">Chat comes in the ACP plan.</p>
    <button class="dev" onclick={() => (showProbe = !showProbe)}>{showProbe ? "Hide" : "Show"} capability probe</button>
    {#if showProbe}<Probe />{/if}
  </section>
  <section class="right">
    {#if !project}
      <ProjectPicker onOpen={opened} />
    {:else}
      <header>
        <span class="root" title={project.root}>{project.root.split("/").at(-1)}</span>
        <CompositionSwitcher compositions={project.compositions} selected={entry} onSelect={(c) => (entry = c)} />
      </header>
      {#if entry}
        {#key entry}
          <Preview {entry} onRootFilesChanged={refreshCompositions} />
        {/key}
      {:else}
        <p class="placeholder">No composition files (*.ts) in the project root.</p>
      {/if}
    {/if}
  </section>
</main>

<style>
  :global(:root) {
    --bg: #f6f6f7; --panel: #ffffff; --raised: #f0f0f2; --border: #dcdce0; --fg: #1b1b1f; --muted: #6b6b75; --danger: #c62828;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) { --bg: #111113; --panel: #18181b; --raised: #232328; --border: #2e2e34; --fg: #ececf0; --muted: #8d8d98; --danger: #ff6b6b; }
  }
  :global(html, body) { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 13px system-ui, -apple-system, sans-serif; }
  main { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; height: 100vh; }
  section { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .chat { border-right: 1px solid var(--border); background: var(--panel); }
  header { display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--border); font-weight: 600; flex-shrink: 0; }
  .root { color: var(--muted); font-weight: 500; }
  .placeholder { color: var(--muted); padding: 12px; }
  .dev { margin: auto 12px 12px; font: inherit; font-size: 11px; background: none; border: none; color: var(--muted); cursor: pointer; text-align: left; }
  .right { background: var(--bg); }
</style>
