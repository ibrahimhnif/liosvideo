<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { AgentApi, ProjectStats, SelectionContext } from "$lib/chat/api";
  import { applyEvent, initialChat, type ChatEvent } from "$lib/chat/reduce";
  import { detectOutOfScopeChanges } from "$lib/chat/scope_warning";
  import { selectionLabel, type Selection } from "$lib/timeline/model";
  import ChatItem from "./ChatItem.svelte";
  import ScopeWarningCard from "./ScopeWarningCard.svelte";
  import SelectionChip from "./SelectionChip.svelte";

  let { api, selection, playhead, onClearSelection }: {
    api: AgentApi;
    selection?: Selection;
    playhead: { frame: number; fps: number };
    onClearSelection: () => void;
  } = $props();

  let chat = $state(initialChat());
  let text = $state("");
  let list: HTMLDivElement | undefined = $state();
  let yolo = $state(false);
  let outOfScopeWarning = $state<{ files: string[]; commitId: string } | null>(null);
  let stats = $state<ProjectStats | null>(null);
  let showStatsDetail = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("liosvideo:yolo") === "true";
      if (yolo !== saved) {
        yolo = saved;
        api.setAutoApprove(saved).catch(() => {});
      }
    }
  });

  function toggleYolo() {
    yolo = !yolo;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("liosvideo:yolo", String(yolo));
    }
    api.setAutoApprove(yolo).catch(fail);
  }

  const ready = $derived(chat.connection?.state === "ready");
  const running = $derived(chat.turn === "running");
  const agentName = $derived(chat.connection?.agentInfo?.title ?? chat.connection?.agentInfo?.name ?? chat.connection?.agentId ?? "No agent");

  const modelOption = $derived.by(() => {
    const opts = chat.connection?.configOptions;
    if (Array.isArray(opts)) {
      const found = opts.find((o) => o.id === "model" || o.category === "model");
      if (found) return found;
    }
    const m = chat.connection?.models;
    if (m?.availableModels && Array.isArray(m.availableModels)) {
      return {
        id: "model",
        name: "Model",
        currentValue: m.currentModelId,
        options: m.availableModels.map((x: any) => ({
          value: x.id ?? x.value,
          name: x.name ?? x.id,
          description: x.description,
        })),
      };
    }
    return undefined;
  });

  function changeModel(val: string) {
    if (!val) return;
    push({
      type: "update",
      update: {
        sessionUpdate: "config_option_update",
        configId: "model",
        value: val,
      },
    });
    api.setConfigOption("model", val).catch(fail);
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (chat.items.length > 0) {
        api.saveConversation(JSON.stringify({ items: chat.items })).catch(() => {});
      }
    }, 400);
  }

  async function push(e: ChatEvent) {
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    chat = applyEvent(chat, e);
    scheduleSave();

    if (e.type === "turn" && e.state === "ended") {
      const lastUser = [...chat.items].reverse().find((x) => x.kind === "user");
      const lastAgent = [...chat.items].reverse().find((x) => x.kind === "agent");
      const inChars = (lastUser?.kind === "user" ? lastUser.text.length : 0) + 400;
      const outChars = lastAgent?.kind === "agent" ? lastAgent.text.length : 120;
      const inTokens = Math.max(1, Math.round(inChars / 4));
      const outTokens = Math.max(1, Math.round(outChars / 4));
      api.recordTokenUsage(inTokens, outTokens, modelOption?.currentValue).catch(() => {});
    }

    if (atBottom) {
      await tick();
      list?.scrollTo({ top: list.scrollHeight });
    }
  }

  onMount(() => {
    const unsubApi = api.on(push);
    let unsubEvent: (() => void) | undefined;
    let unsubStats: (() => void) | undefined;

    api.loadConversation().then((saved) => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            chat = {
              ...chat,
              items: parsed.items,
              nextId: Math.max(...parsed.items.map((i: any) => parseInt(String(i.id).slice(1)) || 0), 0) + 1,
            };
          }
        } catch {
          // Ignore parse errors on corrupted local file
        }
      }
    }).catch(() => {});

    api.getProjectStats().then((s) => {
      if (s) stats = s;
    }).catch(() => {});

    listen<ProjectStats>("project://stats_updated", (e) => {
      if (e.payload) stats = e.payload;
    }).then((u) => {
      unsubStats = u;
    }).catch(() => {});

    listen<{ id: string; summary: string }>("project://committed", async (e) => {
      if (!selection || e.payload.summary.startsWith("Revert out-of-scope")) return;
      try {
        const diffs = await invoke<Array<{ path: string }>>("commit_diff", { id: e.payload.id });
        const changed = diffs.map((d) => d.path);
        const res = detectOutOfScopeChanges(changed, selection);
        if (res.hasOutOfScope) {
          outOfScopeWarning = { files: res.outOfScopeFiles, commitId: e.payload.id };
        } else {
          outOfScopeWarning = null;
        }
      } catch {
        // Ignore diff query failures in mock or detached environments
      }
    }).then((u) => {
      unsubEvent = u;
    }).catch(() => {});

    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      unsubApi();
      unsubEvent?.();
      unsubStats?.();
    };
  });

  async function revertOutOfScope() {
    if (!outOfScopeWarning) return;
    try {
      await invoke("revert_commit_files", {
        id: outOfScopeWarning.commitId,
        paths: outOfScopeWarning.files,
      });
      outOfScopeWarning = null;
    } catch (err) {
      fail(err);
    }
  }

  function toContext(sel: Selection | undefined): SelectionContext | undefined {
    if (!sel) return undefined;
    const { composition, sceneId, sceneFile, path, startFrame, endFrame } = sel;
    return { composition, sceneId, sceneFile, path, startFrame, endFrame, fps: playhead.fps, playheadFrame: playhead.frame };
  }

  const fail = (e: unknown) => push({ type: "turn", state: "ended", error: String(e) });

  function send() {
    const prompt = text.trim();
    if (!prompt || !ready || running) return;
    text = "";
    push({ type: "user", text: prompt, selection: selection ? selectionLabel(selection) : undefined });
    api.prompt(prompt, toContext(selection)).catch(fail);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function answer(requestId: string, optionId: string) {
    push({ type: "answered", requestId, optionId });
    api.respond(requestId, optionId).catch(fail);
  }

  function resolveAsset(requestId: string, filePath?: string | null) {
    push({
      type: "asset_resolved",
      requestId,
      answer: filePath ? "provided" : "skipped",
      filePath: filePath ?? undefined,
    });
    api.resolveAssetRequest(requestId, filePath).catch(fail);
  }
</script>

<div class="chat">
  <div class="bar">
    <span class="dot {chat.connection?.state ?? 'none'}" title={chat.connection?.state ?? "disconnected"}></span>
    <span class="name">{agentName}</span>
    {#if modelOption && modelOption.options && modelOption.options.length > 0}
      <select
        class="model-select"
        value={modelOption.currentValue ?? ""}
        disabled={running || !ready}
        onchange={(e) => changeModel(e.currentTarget.value)}
        title="Active Model"
      >
        {#each modelOption.options as opt (opt.value)}
          <option value={opt.value} title={opt.description ?? ""}>{opt.name ?? opt.value}</option>
        {/each}
      </select>
    {/if}
    <span class="spacer"></span>
    <button
      type="button"
      class="cost-btn"
      class:active={showStatsDetail}
      onclick={() => (showStatsDetail = !showStatsDetail)}
      title="Cost & Usage Tracing (TTS & Tokens)"
    >
      💰 {stats?.totalCostUsd ? `$${stats.totalCostUsd.toFixed(3)}` : "$0.00"}
    </button>
    <button
      class="yolo-btn"
      class:active={yolo}
      onclick={toggleYolo}
      title={yolo ? "Yolo mode active: permissions are auto-approved" : "Yolo mode off: prompt for permissions"}
    >
      ⚡ Yolo
    </button>
    {#if running}
      <button onclick={() => api.cancel().catch(fail)}>Cancel</button>
    {:else}
      <button onclick={() => api.connect().catch(fail)}>{chat.connection ? "Reconnect" : "Connect"}</button>
    {/if}
  </div>
  {#if showStatsDetail}
    <div class="stats-panel">
      <div class="stats-header">
        <span class="stats-title">💰 Cost & Usage Tracing</span>
        <button class="stats-close" onclick={() => (showStatsDetail = false)}>✕</button>
      </div>
      <div class="stats-body">
        <div class="stats-row total">
          <span>Total Project Cost:</span>
          <strong>${(stats?.totalCostUsd ?? 0).toFixed(4)}</strong>
        </div>
        <div class="stats-section">
          <div class="stats-subhead">🎙️ TTS Audio Synthesis</div>
          <div class="stats-row">
            <span>Characters:</span>
            <span>{(stats?.tts?.totalCharacters ?? 0).toLocaleString()} chars</span>
          </div>
          <div class="stats-row">
            <span>Est. Cost:</span>
            <span>${(stats?.tts?.totalCostUsd ?? 0).toFixed(4)}</span>
          </div>
          {#if stats?.tts?.items && stats.tts.items.length > 0}
            <div class="tts-history">
              {#each [...stats.tts.items].reverse().slice(0, 4) as item}
                <div class="tts-history-item">
                  <span class="line-id">{item.lineId}</span>
                  <span class="voice-name">{item.provider}</span>
                  <span class="chars">{item.characters}c (${item.costUsd.toFixed(4)})</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        <div class="stats-section">
          <div class="stats-subhead">🤖 LLM Token Consumption</div>
          <div class="stats-row">
            <span>Input Tokens:</span>
            <span>{(stats?.tokens?.inputTokens ?? 0).toLocaleString()}</span>
          </div>
          <div class="stats-row">
            <span>Output Tokens:</span>
            <span>{(stats?.tokens?.outputTokens ?? 0).toLocaleString()}</span>
          </div>
          <div class="stats-row">
            <span>Total Tokens:</span>
            <span>{(stats?.tokens?.totalTokens ?? 0).toLocaleString()}</span>
          </div>
          <div class="stats-row">
            <span>Est. Cost:</span>
            <span>${(stats?.tokens?.totalCostUsd ?? 0).toFixed(4)}</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
  {#if chat.connection?.state === "auth_required"}
    <div class="auth">
      <p>The agent needs you to log in.</p>
      {#each chat.connection.authMethods ?? [] as m (m.id)}
        <button title={m.description ?? ""} onclick={() => api.authenticate(m.id).catch(fail)}>{m.name}</button>
      {/each}
    </div>
  {/if}
  <div class="items" bind:this={list}>
    {#each chat.items as item (item.id)}
      <ChatItem {item} onAnswer={answer} onResolveAsset={resolveAsset} />
    {/each}
    {#if running}<div class="working">Working…</div>{/if}
  </div>
  {#if outOfScopeWarning && outOfScopeWarning.files.length > 0}
    <ScopeWarningCard
      files={outOfScopeWarning.files}
      onRevert={revertOutOfScope}
      onDismiss={() => (outOfScopeWarning = null)}
    />
  {/if}
  <SelectionChip {selection} onClear={onClearSelection} />
  <form class="composer" onsubmit={(e) => (e.preventDefault(), send())}>
    <textarea rows="3" placeholder={ready ? "Ask the agent… (Enter to send, Shift+Enter for a new line)" : "Ask the agent… (connect first)"} bind:value={text} onkeydown={onKey}></textarea>
    <button type="submit" disabled={!ready || running || !text.trim()}>Send</button>
  </form>
</div>

<style>
  .chat { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
  .name { font-weight: 500; }
  .model-select {
    font: inherit;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    max-width: 150px;
    outline: none;
    cursor: pointer;
  }
  .model-select:disabled { opacity: 0.5; cursor: default; }
  .yolo-btn {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .yolo-btn.active {
    background: color-mix(in srgb, #e0a100 20%, transparent);
    border-color: #e0a100;
    color: #e0a100;
    font-weight: 500;
  }
  .spacer { flex: 1; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .dot.ready { background: #2e9d57; }
  .dot.connecting { background: #e0a100; }
  .dot.auth_required { background: #e0a100; }
  .dot.error, .dot.exited { background: var(--danger); }
  button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .auth { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-bottom: 1px solid var(--border); }
  .auth p { margin: 0; width: 100%; color: var(--muted); font-size: 12px; }
  .items { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
  .working { color: var(--muted); font-size: 12px; }
  .composer { display: flex; gap: 6px; padding: 8px 12px 12px; align-items: flex-end; }
  textarea { flex: 1; resize: none; font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); }

  .cost-btn {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .cost-btn:hover, .cost-btn.active {
    background: rgba(46, 160, 67, 0.15);
    border-color: #2ea043;
    color: #3fb950;
  }

  .stats-panel {
    border-bottom: 1px solid var(--border);
    background: #161b22;
    padding: 10px 14px;
    font-size: 12px;
    animation: fadeIn 0.15s ease;
  }
  .stats-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .stats-title {
    font-weight: 600;
    color: #f0f6fc;
  }
  .stats-close {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
  }
  .stats-close:hover {
    color: #f0f6fc;
  }
  .stats-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stats-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #c9d1d9;
    font-size: 11px;
  }
  .stats-row.total {
    font-size: 13px;
    color: #3fb950;
    font-weight: 500;
    margin-bottom: 4px;
  }
  .stats-section {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stats-subhead {
    font-size: 11px;
    font-weight: 600;
    color: #58a6ff;
    margin-bottom: 2px;
  }
  .tts-history {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tts-history-item {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: var(--muted);
  }
  .tts-history-item .line-id {
    color: #e6edf3;
    font-family: monospace;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
