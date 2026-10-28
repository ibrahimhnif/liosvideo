<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { AgentApi, ProjectStats, SelectionContext } from "$lib/chat/api";
  import { applyEvent, initialChat, type AttachedImage, type ChatEvent } from "$lib/chat/reduce";
  import { detectOutOfScopeChanges } from "$lib/chat/scope_warning";
  import { selectionLabel, type Selection } from "$lib/timeline/model";
  import { devLog } from "$lib/devlog";
  import ChatItem from "./ChatItem.svelte";
  import ScopeWarningCard from "./ScopeWarningCard.svelte";
  import SelectionChip from "./SelectionChip.svelte";

  let { api, projectRoot, selection, playhead, onClearSelection }: {
    api: AgentApi;
    projectRoot?: string;
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
  let hasLoadedHistory = $state(false);
  let pendingImages = $state<AttachedImage[]>([]);
  let isUploadingImage = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let isDraggingOver = $state(false);

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

  let lastLoadedRoot = $state<string | undefined>(undefined);
  $effect(() => {
    const currentRoot = projectRoot;
    if (currentRoot && currentRoot !== lastLoadedRoot) {
      lastLoadedRoot = currentRoot;
      loadHistory(currentRoot);
      loadStats(currentRoot);
    }
  });

  export async function saveNow(explicitRoot?: string) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    const targetRoot = explicitRoot ?? projectRoot;
    if (hasLoadedHistory && chat.items.length > 0) {
      try {
        await api.saveConversation(JSON.stringify({ items: chat.items }), targetRoot);
      } catch (e) {
        devLog(`save-conversation-failed: ${e}`);
      }
    }
  }

  function scheduleSave() {
    if (!hasLoadedHistory) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow();
    }, 400);
  }

  export async function loadHistory(root?: string) {
    const targetRoot = root ?? projectRoot;
    hasLoadedHistory = false;
    try {
      const saved = await api.loadConversation(targetRoot);
      devLog(`load-conversation (${targetRoot}): received ${saved ? `${saved.length} chars` : "null"}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            const seenIds = new Set<string>();
            const sanitized = parsed.items.map((item: any, idx: number) => {
              let id = item.id ? String(item.id) : `item-${idx}`;
              if (seenIds.has(id)) {
                id = `${id}-${idx}`;
              }
              seenIds.add(id);
              if (item.kind === "tool") {
                return {
                  ...item,
                  id,
                  locations: Array.isArray(item.locations) ? item.locations : [],
                  content: Array.isArray(item.content) ? item.content : [],
                };
              }
              if (item.kind === "permission") {
                return {
                  ...item,
                  id,
                  options: Array.isArray(item.options) ? item.options : [],
                };
              }
              if (item.kind === "plan") {
                return {
                  ...item,
                  id,
                  entries: Array.isArray(item.entries) ? item.entries : [],
                };
              }
              return { ...item, id };
            });

            const maxId = sanitized.reduce((max: number, item: any) => {
              const num = parseInt(String(item.id).replace(/\D+/g, ""), 10);
              return !isNaN(num) && num > max ? num : max;
            }, 0);
            chat = {
              ...chat,
              items: sanitized,
              nextId: maxId + 1,
            };
            devLog(`rendered conversation history: ${sanitized.length} items`);
            await tick();
            if (list) list.scrollTop = list.scrollHeight;
            setTimeout(() => {
              if (list) list.scrollTop = list.scrollHeight;
            }, 100);
          } else {
            chat = { ...chat, items: [], nextId: 1 };
          }
        } catch (e) {
          devLog(`failed to parse conversation ${e}`);
        }
      } else {
        chat = { ...chat, items: [], nextId: 1 };
      }
    } catch (e) {
      devLog(`failed to load conversation ${e}`);
    } finally {
      hasLoadedHistory = true;
    }
  }

  function loadStats(root?: string) {
    api.getProjectStats(root ?? projectRoot).then((s) => {
      if (s) stats = s;
    }).catch(() => {});
  }

  async function push(e: ChatEvent) {
    const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    chat = applyEvent(chat, e);

    if (
      e.type === "user" ||
      (e.type === "turn" && e.state === "ended") ||
      e.type === "answered" ||
      e.type === "asset_resolved"
    ) {
      saveNow();
    } else {
      scheduleSave();
    }

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

    if (!lastLoadedRoot) {
      loadHistory(projectRoot);
      loadStats(projectRoot);
    }

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

    const onBeforeUnload = () => saveNow();
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      saveNow();
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

  async function attachImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    isUploadingImage = true;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const pureBase64 = dataUrl.split(",")[1];
      const saved = await api.saveImageAsset(file.name || "image.png", pureBase64);
      pendingImages = [
        ...pendingImages,
        {
          dataUrl,
          relPath: saved.relPath,
          filename: saved.filename,
          data: pureBase64,
          mimeType: file.type || "image/png",
        },
      ];
    } catch (e) {
      fail(`Failed to attach image: ${e}`);
    } finally {
      isUploadingImage = false;
    }
  }

  async function onFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    for (const file of Array.from(input.files)) {
      await attachImageFile(file);
    }
    input.value = "";
  }

  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await attachImageFile(file);
      }
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        void attachImageFile(file);
      }
    }
  }

  function removePendingImage(index: number) {
    pendingImages = pendingImages.filter((_, i) => i !== index);
  }

  function clearChatHistory() {
    if (running) return;
    if (chat.items.length === 0) return;
    if (typeof confirm !== "undefined" && !confirm("Clear conversation history for this project?")) {
      return;
    }
    chat = { ...chat, items: [], nextId: 1 };
    api.saveConversation(JSON.stringify({ items: [] }), projectRoot).catch(() => {});
  }

  function send() {
    const prompt = text.trim();
    if ((!prompt && pendingImages.length === 0) || !ready || running) return;
    const promptToSend = prompt || "Use the attached image in the scene";
    text = "";
    const imagesToSend = [...pendingImages];
    pendingImages = [];

    push({
      type: "user",
      text: promptToSend,
      selection: selection ? selectionLabel(selection) : undefined,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    });

    const apiImages = imagesToSend.map((img) => ({
      data: img.data!,
      mimeType: img.mimeType,
      relPath: img.relPath,
    }));

    if (apiImages.length > 0) {
      api.prompt(promptToSend, toContext(selection), apiImages).catch(fail);
    } else {
      api.prompt(promptToSend, toContext(selection)).catch(fail);
    }
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
    <button
      type="button"
      class="clear-btn"
      onclick={clearChatHistory}
      disabled={running || chat.items.length === 0}
      title="Clear conversation history"
      aria-label="Clear conversation history"
    >
      🗑️
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
  <form
    class="composer"
    class:drag-over={isDraggingOver}
    onsubmit={(e) => (e.preventDefault(), send())}
    ondragover={(e) => { e.preventDefault(); isDraggingOver = true; }}
    ondragleave={() => (isDraggingOver = false)}
    ondrop={handleDrop}
  >
    {#if pendingImages.length > 0}
      <div class="pending-images">
        {#each pendingImages as img, i (img.relPath + i)}
          <div class="pending-chip">
            <img src={img.dataUrl} alt={img.filename} />
            <span class="pending-name" title={img.relPath}>{img.filename}</span>
            <button
              type="button"
              class="remove-img"
              onclick={() => removePendingImage(i)}
              title="Remove image"
            >✕</button>
          </div>
        {/each}
      </div>
    {/if}
    <input
      type="file"
      accept="image/*"
      multiple
      hidden
      bind:this={fileInput}
      onchange={onFileInputChange}
    />
    <textarea
      rows="3"
      placeholder={ready ? "Ask the agent… (Enter to send, Shift+Enter for newline, paste/drop images)" : "Ask the agent… (connect first)"}
      bind:value={text}
      onkeydown={onKey}
      onpaste={handlePaste}
    ></textarea>
    <div class="composer-footer">
      <button
        type="button"
        class="attach-btn"
        disabled={running || isUploadingImage}
        onclick={() => fileInput?.click()}
        title="Attach image (saved to assets/images/)"
      >
        🖼️ Attach
      </button>
      <span class="spacer"></span>
      <button type="submit" disabled={!ready || running || (!text.trim() && pendingImages.length === 0)}>
        Send
      </button>
    </div>
  </form>
</div>

<style>
  .chat { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); min-width: 0; }
  .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; min-width: 0; }
  .model-select {
    font: inherit;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
    max-width: 110px;
    min-width: 0;
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
  .clear-btn {
    font-size: 11px;
    padding: 2px 5px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .clear-btn:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
  }
  .items { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
  .working { color: var(--muted); font-size: 12px; }
  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 12px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    transition: background 0.15s ease;
  }
  .composer.drag-over {
    background: color-mix(in srgb, #4f8cff 10%, var(--panel));
    border-color: #4f8cff;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: none;
    font: inherit;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg);
  }
  .composer-footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .attach-btn {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--fg);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .attach-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: #4f8cff;
  }
  .pending-images {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 120px;
    overflow-y: auto;
  }
  .pending-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 2px;
    border-radius: 6px;
    background: var(--raised);
    border: 1px solid var(--border);
    font-size: 11px;
  }
  .pending-chip img {
    width: 24px;
    height: 24px;
    object-fit: cover;
    border-radius: 4px;
  }
  .pending-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
  .remove-img {
    background: none;
    border: none;
    padding: 0 3px;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
  }
  .remove-img:hover {
    color: var(--danger);
  }

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
