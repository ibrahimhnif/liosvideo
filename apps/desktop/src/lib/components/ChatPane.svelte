<script lang="ts">
  import { onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { AgentApi, SelectionContext } from "$lib/chat/api";
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

  async function push(e: ChatEvent) {
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    chat = applyEvent(chat, e);
    if (atBottom) {
      await tick();
      list?.scrollTo({ top: list.scrollHeight });
    }
  }

  onMount(() => {
    const unsubApi = api.on(push);
    let unsubEvent: (() => void) | undefined;

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
      unsubApi();
      unsubEvent?.();
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
</style>
