<script lang="ts">
  import type { ChatItem } from "$lib/chat/reduce";

  let { item, onAnswer }: { item: Extract<ChatItem, { kind: "permission" }>; onAnswer: (optionId: string) => void } = $props();
</script>

<div class="card" class:answered={item.answer !== undefined}>
  <div class="title">
    {item.title}
    {#if item.autoApproved}<span class="yolo-badge">⚡ Auto-approved</span>{/if}
  </div>
  <div class="options">
    {#each item.options as o (o.optionId)}
      <button class={o.kind.startsWith("reject") ? "reject" : "allow"} class:chosen={item.answer === o.optionId} disabled={item.answer !== undefined} onclick={() => onAnswer(o.optionId)}>{o.name}</button>
    {/each}
  </div>
  {#if item.answer === "cancelled"}<div class="note">Cancelled</div>{/if}
</div>

<style>
  .card { border: 1px solid color-mix(in srgb, #e0a100 50%, var(--border)); background: color-mix(in srgb, #e0a100 8%, var(--panel)); border-radius: 8px; padding: 8px 10px; }
  .card.answered { opacity: 0.7; }
  .title { font-weight: 500; margin-bottom: 6px; word-break: break-word; }
  .yolo-badge { font-size: 11px; font-weight: normal; margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: color-mix(in srgb, #e0a100 20%, transparent); color: #e0a100; display: inline-block; }
  .options { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  button:disabled { cursor: default; }
  button.chosen { outline: 2px solid #4f8cff; }
  .reject { color: var(--danger); }
  .note { color: var(--muted); font-size: 11px; margin-top: 4px; }
</style>
