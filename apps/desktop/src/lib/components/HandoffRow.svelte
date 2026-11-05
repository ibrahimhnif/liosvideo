<script lang="ts">
  import { ArrowRightLeft } from "@lucide/svelte";
  import type { ChatItem } from "$lib/chat/reduce";

  let { item }: { item: Extract<ChatItem, { kind: "handoff" }> } = $props();

  const detail = $derived(
    `${item.selected} item${item.selected === 1 ? "" : "s"}` +
      (item.omitted > 0 ? ` · ${item.omitted} omitted` : ""),
  );
</script>

<div class="handoff-row">
  <ArrowRightLeft size={13} />
  <span>Context handoff</span>
  <span class="route">{item.from} → {item.to}</span>
  <span class="detail">{detail}</span>
</div>

<style>
  .handoff-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: #8b949e;
    border-top: 1px dashed #30363d;
    border-bottom: 1px dashed #30363d;
    padding: 6px 2px;
  }
  .route {
    color: #7aa2f7;
    font-weight: 600;
  }
  .detail {
    margin-left: auto;
    opacity: 0.75;
  }
</style>
