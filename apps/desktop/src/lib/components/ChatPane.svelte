<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import {
    Coins,
    Cpu,
    ImagePlus,
    Mic,
    Plug,
    RefreshCw,
    SendHorizontal,
    Square,
    Trash2,
    X,
    Zap,
  } from "@lucide/svelte";
  import type { AgentApi, ImageInput, ProjectStats, SelectionContext } from "$lib/chat/api";
  import { applyEvent, initialChat, type AttachedImage, type ChatEvent } from "$lib/chat/reduce";
  import { detectOutOfScopeChanges } from "$lib/chat/scope_warning";
  import { selectionLabel, type Selection } from "$lib/timeline/model";
  import { devLog } from "$lib/devlog";
  import ChatItem from "./ChatItem.svelte";
  import ScopeWarningCard from "./ScopeWarningCard.svelte";
  import SelectionChip from "./SelectionChip.svelte";

  let {
    api,
    projectRoot,
    selection,
    playhead,
    onClearSelection,
    onOpenSettings,
  }: {
    api: AgentApi;
    projectRoot?: string;
    selection?: Selection;
    playhead: { frame: number; fps: number };
    onClearSelection: () => void;
    onOpenSettings?: () => void;
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
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex === -1) return;
      const pureBase64 = dataUrl.slice(commaIndex + 1);

      let mimeType = file.type;
      if (!mimeType || mimeType === "application/octet-stream") {
        const headerMatch = dataUrl.match(/^data:([^;]+);/);
        if (headerMatch && headerMatch[1] && headerMatch[1] !== "application/octet-stream") {
          mimeType = headerMatch[1];
        } else {
          mimeType = "image/png";
        }
      }

      const displayDataUrl = `data:${mimeType};base64,${pureBase64}`;
      const defaultName = file.name && file.name !== "image.png"
        ? file.name
        : `image-${Date.now().toString().slice(-6)}.png`;

      // Prevent duplicate attachment of the exact same image
      if (pendingImages.some((img) => img.data === pureBase64)) {
        return;
      }

      // 1. Instantly display in preview! Zero delay, no loading spinner!
      const newImage: AttachedImage = {
        dataUrl: displayDataUrl,
        filename: defaultName,
        relPath: `assets/images/${defaultName}`,
        data: pureBase64,
        mimeType,
      };
      pendingImages = [...pendingImages, newImage];

      // 2. Persist to project directory asynchronously
      api.saveImageAsset(defaultName, pureBase64)
        .then((saved) => {
          pendingImages = pendingImages.map((img) =>
            img.dataUrl === displayDataUrl
              ? { ...img, relPath: saved.relPath, filename: saved.filename }
              : img
          );
        })
        .catch((e) => {
          devLog(`save-image-asset-notice: ${e}`);
        });
    } catch (e) {
      fail(`Failed to attach image: ${e}`);
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
    const files = e.clipboardData?.files;
    let handled = false;

    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) {
            handled = true;
            void attachImageFile(file);
            break;
          }
        }
      }
    }

    if (!handled && files && files.length > 0) {
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name)) {
          e.preventDefault();
          e.stopPropagation();
          void attachImageFile(file);
          break;
        }
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

    const apiImages: ImageInput[] = imagesToSend.map((img) => ({
      data: img.data!,
      mimeType: img.mimeType || "image/png",
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

  function reconnect() {
    api.connect().catch(fail);
  }

  async function loginTerminal() {
    try {
      await api.openTerminal("claude login");
    } catch {
      try {
        await navigator.clipboard.writeText("claude login");
        devLog("Copied 'claude login' to clipboard");
      } catch (e) {
        devLog(`Failed to copy to clipboard: ${e}`);
      }
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
      aria-label="💰 {stats?.totalCostUsd ? `$${stats.totalCostUsd.toFixed(3)}` : '$0.00'}"
    >
      <Coins size={12} />
      <span>{stats?.totalCostUsd ? `$${stats.totalCostUsd.toFixed(3)}` : "$0.00"}</span>
    </button>
    <button
      class="yolo-btn"
      class:active={yolo}
      onclick={toggleYolo}
      title={yolo ? "Yolo mode active: permissions are auto-approved" : "Yolo mode off: prompt for permissions"}
      aria-label="⚡ Yolo"
    >
      <Zap size={12} />
      <span>Yolo</span>
    </button>
    <button
      type="button"
      class="clear-btn"
      onclick={clearChatHistory}
      disabled={running || chat.items.length === 0}
      title="Clear conversation history"
      aria-label="Clear conversation history"
    >
      <Trash2 size={13} />
    </button>
    {#if running}
      <button onclick={() => api.cancel().catch(fail)} class="action-btn">
        <Square size={12} />
        <span>Cancel</span>
      </button>
    {:else}
      <button onclick={() => api.connect().catch(fail)} class="action-btn">
        {#if chat.connection}
          <RefreshCw size={12} />
          <span>Reconnect</span>
        {:else}
          <Plug size={12} />
          <span>Connect</span>
        {/if}
      </button>
    {/if}
  </div>
  {#if showStatsDetail}
    <div class="stats-panel">
      <div class="stats-header">
        <span class="stats-title"><Coins size={13} /> Cost & Usage Tracing</span>
        <button class="stats-close" onclick={() => (showStatsDetail = false)} aria-label="Close stats">
          <X size={14} />
        </button>
      </div>
      <div class="stats-body">
        <div class="stats-row total">
          <span>Total Project Cost:</span>
          <strong>${(stats?.totalCostUsd ?? 0).toFixed(4)}</strong>
        </div>
        <div class="stats-section">
          <div class="stats-subhead"><Mic size={12} /> TTS Audio Synthesis</div>
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
          <div class="stats-subhead"><Cpu size={12} /> LLM Token Consumption</div>
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
      <ChatItem
        {item}
        onAnswer={answer}
        onResolveAsset={resolveAsset}
        onReconnect={reconnect}
        onLoginTerminal={loginTerminal}
        {onOpenSettings}
      />
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
      <div class="pending-images-section">
        <div class="pending-images-header">
          <span>Attached Image{pendingImages.length > 1 ? "s" : ""} ({pendingImages.length})</span>
        </div>
        <div class="pending-images-grid">
          {#each pendingImages as img, i (img.relPath + i)}
            <div class="pending-card">
              <div class="pending-thumb">
                <img src={img.dataUrl} alt={img.filename} />
                <button
                  type="button"
                  class="remove-img"
                  onclick={() => removePendingImage(i)}
                  title="Remove image"
                  aria-label="Remove image"
                ><X size={12} /></button>
              </div>
              <span class="pending-name" title={img.relPath}>{img.filename}</span>
            </div>
          {/each}
        </div>
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
        disabled={running}
        onclick={() => fileInput?.click()}
        title="Attach image (saved to assets/images/)"
      >
        <ImagePlus size={13} />
        <span>Attach</span>
      </button>
      <span class="spacer"></span>
      <button
        type="submit"
        class="send-btn"
        disabled={!ready || running || (!text.trim() && pendingImages.length === 0)}
      >
        <span>Send</span>
        <SendHorizontal size={13} />
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
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .send-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .auth { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border-bottom: 1px solid var(--border); }
  .auth p { margin: 0; width: 100%; color: var(--muted); font-size: 12px; }
  .clear-btn {
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
  .pending-images-section {
    padding: 8px 10px 6px 10px;
    background: rgba(0, 0, 0, 0.25);
    border-bottom: 1px solid var(--border);
  }
  .pending-images-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pending-images-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 140px;
    overflow-y: auto;
  }
  .pending-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 84px;
    flex-shrink: 0;
  }
  .pending-thumb {
    position: relative;
    width: 84px;
    height: 64px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--raised);
    border: 1px solid var(--border);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }
  .pending-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.15s ease;
  }
  .pending-thumb:hover img {
    transform: scale(1.05);
  }
  .pending-thumb .remove-img {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: rgba(17, 17, 19, 0.85);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.15s ease;
  }
  .pending-thumb .remove-img:hover {
    background: var(--danger);
    border-color: var(--danger);
    transform: scale(1.1);
  }
  .pending-name {
    width: 84px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: var(--muted);
    text-align: center;
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
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .stats-close {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    padding: 2px 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
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
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
