<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { tauriHistoryApi } from "$lib/history/api";
  import CompositionSwitcher from "$lib/components/CompositionSwitcher.svelte";
  import Preview from "$lib/components/Preview.svelte";
  import HistoryPanel from "$lib/components/HistoryPanel.svelte";
  import ProjectPicker, { type ProjectInfo } from "$lib/components/ProjectPicker.svelte";
  import AgentSetup from "$lib/components/AgentSetup.svelte";
  import ChatPane from "$lib/components/ChatPane.svelte";
  import { tauriAgentApi } from "$lib/chat/api";
  import { devLog } from "$lib/devlog";
  import { playhead } from "$lib/playhead.svelte";
  import { select, selection } from "$lib/timeline/selection.svelte";
  import type { LoadedInfo } from "$lib/preview/protocol";
  import ExportModal from "$lib/components/ExportModal.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import ValidationModal from "$lib/components/ValidationModal.svelte";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import Probe from "$lib/probe/Probe.svelte";

  let project = $state<ProjectInfo | null>(null);
  let entry = $state("");
  let showProbe = $state(false);
  let showAgents = $state(false);
  let showSettings = $state(false);
  let showValidation = $state(false);
  let showHistory = $state(false);
  let showExport = $state(false);
  let loadedInfo = $state<LoadedInfo | null>(null);
  let previewInstance = $state<any>(null);

  function opened(info: ProjectInfo) {
    project = info;
    entry = info.compositions.includes("long.ts") ? "long.ts" : (info.compositions[0] ?? "");
  }

  async function openProjectDialog() {
    try {
      const dir = await open({ directory: true, multiple: false, title: "Open project folder" });
      if (typeof dir === "string") {
        const info = await invoke<ProjectInfo>("open_project", { root: dir });
        opened(info);
      }
    } catch (e) {
      devLog(`open-project-failed ${e}`);
    }
  }

  async function closeProject() {
    try {
      await invoke("close_project");
    } catch (e) {
      devLog(`close-project-failed ${e}`);
    } finally {
      project = null;
      entry = "";
      loadedInfo = null;
      select(undefined);
    }
  }

  async function refreshProject() {
    await refreshCompositions();
    previewInstance?.reload?.();
  }

  onMount(() => {
    tauriAgentApi
      .listAgents()
      .then((list) => devLog(`agents ${list.map((a) => `${a.id}:${a.state}`).join(" ")}`))
      .catch((e) => devLog(`agents error ${e}`));
    void invoke<string | null>("initial_project").then(async (root) => {
      if (root) opened(await invoke<ProjectInfo>("open_project", { root }));
    });

    const unlistenSelection = listen<{ composition?: string; sceneId?: string; objectPath?: string; path?: string } | null>(
      "project://selection",
      (e) => {
        const objPath = e.payload?.objectPath ?? e.payload?.path;
        select(
          e.payload
            ? {
                composition: e.payload.composition ?? "",
                sceneId: e.payload.sceneId ?? "",
                path: objPath,
                startFrame: 0,
                endFrame: 0,
              }
            : undefined,
        );
        if (e.payload?.composition && project?.compositions.includes(e.payload.composition)) {
          entry = e.payload.composition;
        }
      },
    );

    return () => {
      void unlistenSelection.then((u) => u()).catch(() => {});
    };
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
    <header>
      liosvideo
      <div class="header-actions">
        <button class="toggle-settings" aria-pressed={showSettings} onclick={() => (showSettings = !showSettings)} title="API Key & TTS Settings">⚙️</button>
        <button class="toggle" aria-pressed={showAgents} onclick={() => (showAgents = !showAgents)}>Agents</button>
      </div>
    </header>
    {#if showAgents}<AgentSetup api={tauriAgentApi} />{/if}
    <!-- kept mounted while the agent list is open so the conversation survives -->
    <div class="chat-slot" hidden={showAgents}>
      {#if project}
        {#key project.root}
          <ChatPane api={tauriAgentApi} selection={selection.current} {playhead} onClearSelection={() => select(undefined)} />
        {/key}
      {:else}
        <p class="placeholder">Open a project to chat with an agent.</p>
      {/if}
    </div>
    <button class="dev" onclick={() => (showProbe = !showProbe)}>{showProbe ? "Hide" : "Show"} capability probe</button>
    {#if showProbe}<Probe />{/if}
  </section>
  <section class="right">
    {#if !project}
      <ProjectPicker onOpen={opened} />
    {:else}
      <header>
        <div class="project-info">
          <span class="root" title={project.root}>{project.root.split("/").at(-1)}</span>
          <CompositionSwitcher compositions={project.compositions} selected={entry} onSelect={(c) => (entry = c)} />
        </div>
        <div class="project-actions">
          <button class="nav-btn" onclick={openProjectDialog} title="Open another project folder">📂 Open</button>
          <button class="nav-btn" onclick={refreshProject} title="Reload compositions and preview">🔄 Refresh</button>
          <button class="nav-btn" onclick={() => (showValidation = true)} title="Validate scene code & constraints">✓ Validate</button>
          <button class="btn-export" onclick={() => (showExport = true)} disabled={!loadedInfo}>Export</button>
          <button class="toggle" aria-pressed={showHistory} onclick={() => (showHistory = !showHistory)}>History</button>
          <button class="nav-btn close-project-btn" onclick={closeProject} title="Close current project">✕ Close</button>
        </div>
      </header>
      <div class="workspace" class:with-history={showHistory}>
        <div class="stage">
          {#if entry}
            {#key entry}
              <Preview
                bind:this={previewInstance}
                {entry}
                onRootFilesChanged={refreshCompositions}
                onInfoChanged={(i) => (loadedInfo = i)}
              />
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
      {#if project}
        <ExportModal
          open={showExport}
          compositionName={entry}
          width={loadedInfo?.width ?? 1920}
          height={loadedInfo?.height ?? 1080}
          fps={loadedInfo?.fps ?? 30}
          totalFrames={loadedInfo?.totalFrames ?? 0}
          onClose={() => (showExport = false)}
          onStartExport={(cfg, onProg) => {
            if (!previewInstance) throw new Error("Preview not ready");
            return previewInstance.runExport(cfg, onProg);
          }}
          onCancelExport={() => {
            previewInstance?.cancelExport?.();
          }}
          onShowInFinder={async (path) => {
            await revealItemInDir(path);
          }}
        />
      {/if}
    {/if}
  </section>
</main>

<SettingsModal open={showSettings} onClose={() => (showSettings = false)} />
<ValidationModal open={showValidation} onClose={() => (showValidation = false)} />

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
  .project-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .project-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .nav-btn { font: inherit; font-size: 12px; font-weight: 500; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; align-items: center; gap: 4px; }
  .nav-btn:hover { background: var(--raised); }
  .close-project-btn { color: var(--muted); }
  .close-project-btn:hover { color: var(--danger); border-color: var(--danger); background: rgba(239, 68, 68, 0.1); }
  .root { color: var(--muted); font-weight: 500; }
  .placeholder { color: var(--muted); padding: 12px; }
  .dev { margin: 0 12px 12px; font: inherit; font-size: 11px; background: none; border: none; color: var(--muted); cursor: pointer; text-align: left; }
  .right { background: var(--bg); }
  .chat-slot { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .chat-slot[hidden] { display: none; }
  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .toggle-settings { font: inherit; font-size: 13px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--fg); cursor: pointer; line-height: 1; }
  .toggle-settings[aria-pressed="true"] { background: var(--raised); }
  .toggle { font: inherit; font-weight: 500; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border); background: none; color: var(--fg); cursor: pointer; }
  .toggle[aria-pressed="true"] { background: var(--raised); }
  .btn-export { font: inherit; font-weight: 500; padding: 3px 12px; border-radius: 6px; border: 1px solid #4f8cff; background: #4f8cff; color: white; cursor: pointer; }
  .btn-export:disabled { opacity: 0.5; cursor: not-allowed; }
  .workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr; }
  .workspace.with-history { grid-template-columns: 1fr 320px; }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
</style>
