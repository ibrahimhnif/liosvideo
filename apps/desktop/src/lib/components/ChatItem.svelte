<script lang="ts">
  import type { ChatItem } from "$lib/chat/reduce";
  import PermissionCard from "./PermissionCard.svelte";

  let { item, onAnswer }: { item: ChatItem; onAnswer: (requestId: string, optionId: string) => void } = $props();
</script>

{#if item.kind === "user"}
  <div class="bubble user">
    {#if item.selection}<div class="sel">{item.selection}</div>{/if}
    <div class="text">{item.text}</div>
  </div>
{:else if item.kind === "agent"}
  <div class="bubble agent"><div class="text">{item.text}</div></div>
{:else if item.kind === "thought"}
  <details class="thought"><summary>Thinking</summary><div class="text">{item.text}</div></details>
{:else if item.kind === "tool"}
  <details class="tool">
    <summary><span class="status {item.status}">{item.status}</span> {item.title}</summary>
    {#each item.locations as l (l)}<div class="mono">{l}</div>{/each}
    {#each item.content as c, i (i)}<div class="text small">{c}</div>{/each}
  </details>
{:else if item.kind === "plan"}
  <div class="plan">
    <div class="label">Plan</div>
    {#each item.entries as e, i (i)}<div class="entry {e.status}">{e.status === "completed" ? "✓" : e.status === "in_progress" ? "▸" : "○"} {e.content}</div>{/each}
  </div>
{:else if item.kind === "permission"}
  <PermissionCard {item} onAnswer={(optionId) => onAnswer(item.id, optionId)} />
{:else if item.kind === "notice"}
  <div class="notice {item.level}">{item.text}</div>
{/if}

<style>
  .bubble { border-radius: 10px; padding: 7px 10px; max-width: 92%; }
  .user { align-self: flex-end; background: color-mix(in srgb, #4f8cff 18%, var(--panel)); }
  .agent { align-self: flex-start; background: var(--raised); }
  .text { white-space: pre-wrap; word-break: break-word; }
  .small { font-size: 12px; color: var(--muted); }
  .sel { font-size: 11px; color: var(--muted); margin-bottom: 3px; }
  details { font-size: 12px; color: var(--muted); }
  summary { cursor: pointer; }
  .mono { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
  .status { text-transform: uppercase; font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--raised); }
  .status.completed { color: #2e9d57; }
  .status.failed { color: var(--danger); }
  .plan { font-size: 12px; border-left: 2px solid var(--border); padding-left: 8px; }
  .label { font-weight: 600; margin-bottom: 2px; }
  .entry.completed { color: var(--muted); text-decoration: line-through; }
  .notice { font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .notice.error { color: var(--danger); }
  .notice.info { color: var(--muted); }
</style>
