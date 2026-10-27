<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { tauriHistoryApi } from "$lib/history/api";
  import CompositionSwitcher from "$lib/components/CompositionSwitcher.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import HistoryPanel from "$lib/components/HistoryPanel.svelte";
  import ProjectPicker, { type ProjectInfo } from "$lib/components/ProjectPicker.svelte";
  import SelectionChip from "$lib/components/SelectionChip.svelte";
  import { select, selection } from "$lib/timeline/selection.svelte";
  import Probe from "$lib/probe/Probe.svelte";

  let project = $state<ProjectInfo | null>(null);
  let entry = $state("");
  let showProbe = $state(false);
  let showHistory = $state(false);

  function opened(info: ProjectInfo) {
    project = info;
    entry = info.compositions.includes("long.ts") ? "long.ts" : (info.compositions[0] ?? "");
  }

  onMount(async () => {
    const root = await invoke<string | null>("initial_project");
    if (root) opened(await invoke<ProjectInfo>("open_project", { root }));
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, [contenteditable]")) select(undefined);
  }

  async function refreshCompositions() {
    if (!project) return;
    const compositions = await invoke<string[]>("list_compositions");
    project = { ...project, compositions };
    if (!compositions.includes(entry)) entry = compositions[0] ?? "";
  }
</script>

<svelte:window onkeydown={onKey} />

<main>
  <section class="chat">
    <header>liosvideo</header>
    <div class="spacer"></div>
    <SelectionChip selection={selection.current} onClear={() => select(undefined)} />
    <p class="placeholder">Chat comes in the ACP plan. Select a scene or object on the timeline to target a revision.</p>
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
        <button class="toggle" aria-pressed={showHistory} onclick={() => (showHistory = !showHistory)}>History</button>
      </header>
      <div class="workspace" class:with-history={showHistory}>
        <div class="stage">
          {#if entry}
            {#key entry}
              <Preview {entry} onRootFilesChanged={refreshCompositions} />
            {/key}
          {:else}
            <p class="placeholder">No composition files (*.ts) in the project root.</p>
          {/if}
        </div>
        {#if showHistory}
          {#key project.root}
            <HistoryPanel status={project.history} api={tauriHistoryApi} onStatus={(history) => project && (project = { ...project, history })} />
          {/key}
        {/if}
      </div>
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
  .spacer { flex: 1; }
  .dev { margin: 0 12px 12px; font: inherit; font-size: 11px; background: none; border: none; color: var(--muted); cursor: pointer; text-align: left; }
  .right { background: var(--bg); }
  .toggle { margin-left: auto; font: inherit; font-weight: 500; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--fg); cursor: pointer; }
  .toggle[aria-pressed="true"] { background: var(--raised); }
  .workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr; }
  .workspace.with-history { grid-template-columns: 1fr 320px; }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
</style>
