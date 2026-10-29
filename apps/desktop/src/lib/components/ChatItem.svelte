<script lang="ts">
  import {
    Brain,
    CheckCircle2,
    Circle,
    Clock,
    Film,
    Key,
    ListTodo,
    RefreshCw,
    Terminal,
    TriangleAlert,
    Wrench,
  } from "@lucide/svelte";
  import type { ChatItem } from "$lib/chat/reduce";
  import AssetCard from "./AssetCard.svelte";
  import Markdown from "./Markdown.svelte";
  import PermissionCard from "./PermissionCard.svelte";
  import VoiceCard from "./VoiceCard.svelte";

  let {
    item,
    onAnswer,
    onResolveAsset,
    onReconnect,
    onLoginTerminal,
    onOpenSettings,
  }: {
    item: ChatItem;
    onAnswer: (requestId: string, optionId: string) => void;
    onResolveAsset?: (requestId: string, filePath?: string | null) => void;
    onReconnect?: () => void;
    onLoginTerminal?: () => void;
    onOpenSettings?: () => void;
  } = $props();

  function isAuthError(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("oauth session expired") ||
      lower.includes("failed to authenticate") ||
      lower.includes("failed to refresh oauth") ||
      lower.includes("authentication required") ||
      lower.includes("not logged in") ||
      lower.includes("auth required") ||
      lower.includes("unauthorized")
    );
  }
</script>

{#if item.kind === "user"}
  <div class="bubble user">
    {#if item.selection}<div class="sel">{item.selection}</div>{/if}
    {#if item.images && item.images.length > 0}
      <div class="attached-images">
        {#each item.images as img, i (i)}
          <div class="img-preview">
            <img src={img.dataUrl || img.relPath} alt={img.filename} />
            <span class="img-tag">{img.relPath}</span>
          </div>
        {/each}
      </div>
    {/if}
    {#if item.videos && item.videos.length > 0}
      <div class="attached-videos">
        {#each item.videos as vid, i (i)}
          <div class="vid-preview" title={vid.relPath}>
            <Film size={13} class="vid-icon" />
            <span class="vid-tag">{vid.relPath}</span>
          </div>
        {/each}
      </div>
    {/if}
    <div class="text"><Markdown content={item.text} /></div>
  </div>
{:else if item.kind === "agent"}
  <div class="bubble agent"><div class="text"><Markdown content={item.text} /></div></div>
{:else if item.kind === "thought"}
  <details class="thought">
    <summary>
      <Brain size={12} />
      <span>Thinking</span>
    </summary>
    <div class="text"><Markdown content={item.text} /></div>
  </details>
{:else if item.kind === "tool"}
  <details class="tool">
    <summary>
      <Wrench size={12} />
      <span class="status {item.status}">{item.status}</span>
      <span>{item.title}</span>
    </summary>
    {#if item.locations}
      {#each item.locations as l, i (`${i}-${l}`)}<div class="mono">{l}</div>{/each}
    {/if}
    {#if item.content}
      {#each item.content as c, i (i)}<div class="text small">{c}</div>{/each}
    {/if}
  </details>
{:else if item.kind === "plan"}
  <div class="plan">
    <div class="label">
      <ListTodo size={13} />
      <span>Plan</span>
    </div>
    {#if item.entries}
      {#each item.entries as e, i (i)}
        <div class="entry {e.status}">
          {#if e.status === "completed"}
            <CheckCircle2 size={12} />
          {:else if e.status === "in_progress"}
            <Clock size={12} />
          {:else}
            <Circle size={12} />
          {/if}
          <span>{e.content}</span>
        </div>
      {/each}
    {/if}
  </div>
{:else if item.kind === "permission"}
  <PermissionCard {item} onAnswer={(optionId) => onAnswer(item.requestId, optionId)} />
{:else if item.kind === "asset"}
  <AssetCard {item} onResolve={(reqId, filePath) => onResolveAsset?.(reqId, filePath)} />
{:else if item.kind === "voice"}
  <VoiceCard lineId={item.lineId} text={item.text} audioPath={item.audioPath} />
{:else if item.kind === "notice"}
  {#if item.level === "error" && isAuthError(item.text)}
    <div class="auth-notice-card" data-testid="auth-notice-card">
      <div class="auth-header">
        <TriangleAlert size={14} class="auth-icon" />
        <span class="auth-title">Authentication Required</span>
      </div>
      <div class="auth-message">{item.text}</div>
      <div class="auth-actions">
        {#if onReconnect}
          <button class="auth-btn primary" onclick={onReconnect} title="Retry connecting to agent">
            <RefreshCw size={12} />
            <span>Reconnect</span>
          </button>
        {/if}
        {#if onLoginTerminal}
          <button class="auth-btn secondary" onclick={onLoginTerminal} title="Run claude login in Terminal">
            <Terminal size={12} />
            <span>Login via Terminal</span>
          </button>
        {/if}
        {#if onOpenSettings}
          <button class="auth-btn secondary" onclick={onOpenSettings} title="Configure API key in Settings">
            <Key size={12} />
            <span>Set API Key</span>
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="notice {item.level}">{item.text}</div>
  {/if}
{/if}

<style>
  .bubble { border-radius: 10px; padding: 7px 10px; max-width: 92%; }
  .user { align-self: flex-end; background: color-mix(in srgb, #4f8cff 18%, var(--panel)); }
  .attached-images { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .attached-videos { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .img-preview { display: flex; flex-direction: column; gap: 2px; max-width: 140px; }
  .img-preview img { width: 100%; max-height: 100px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); }
  .img-tag { font-family: ui-monospace, monospace; font-size: 10px; color: var(--muted); word-break: break-all; }
  .vid-preview { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 6px; background: color-mix(in srgb, #38bdf8 15%, var(--panel)); border: 1px solid color-mix(in srgb, #38bdf8 30%, transparent); }
  :global(.vid-icon) { color: #38bdf8; flex-shrink: 0; }
  .vid-tag { font-family: ui-monospace, monospace; font-size: 11px; color: #7dd3fc; word-break: break-all; }
  .agent { align-self: flex-start; background: var(--raised); }
  .text { white-space: pre-wrap; word-break: break-word; }
  .small { font-size: 12px; color: var(--muted); }
  .sel { font-size: 11px; color: var(--muted); margin-bottom: 3px; }
  details { font-size: 12px; color: var(--muted); }
  summary { cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
  .mono { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
  .status { text-transform: uppercase; font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--raised); }
  .status.completed { color: #2e9d57; }
  .status.failed { color: var(--danger); }
  .plan { font-size: 12px; border-left: 2px solid var(--border); padding-left: 8px; }
  .label { font-weight: 600; margin-bottom: 4px; display: inline-flex; align-items: center; gap: 5px; }
  .entry { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
  .entry.completed { color: var(--muted); text-decoration: line-through; }
  .notice { font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .notice.error { color: var(--danger); }
  .notice.info { color: var(--muted); }

  .auth-notice-card {
    background: color-mix(in srgb, #f7768e 10%, var(--raised));
    border: 1px solid color-mix(in srgb, #f7768e 35%, transparent);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0;
  }
  .auth-header {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f7768e;
    font-weight: 600;
    font-size: 12px;
  }
  .auth-message {
    font-size: 12px;
    color: var(--fg);
    white-space: pre-wrap;
    word-break: break-word;
    opacity: 0.9;
  }
  .auth-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .auth-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .auth-btn.primary {
    background: #7aa2f7;
    color: #1a1b26;
    border: 1px solid #7aa2f7;
  }
  .auth-btn.primary:hover {
    background: #89b4fa;
  }
  .auth-btn.secondary {
    background: var(--raised);
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .auth-btn.secondary:hover {
    background: color-mix(in srgb, var(--fg) 8%, var(--raised));
    border-color: color-mix(in srgb, var(--fg) 25%, transparent);
  }
</style>
