<script lang="ts">
  import { AlertTriangle, ArrowRightLeft, Cpu } from "@lucide/svelte";
  import type { AgentStatus, ConfigOption } from "$lib/chat/api";
  import type { ChatItem } from "$lib/chat/reduce";

  let {
    item,
    agents,
    modelOption,
    disabled,
    onSwitchModel,
    onContinue,
  }: {
    item: Extract<ChatItem, { kind: "limit" }>;
    agents: AgentStatus[];
    modelOption?: ConfigOption;
    disabled?: boolean;
    onSwitchModel: (value: string) => void;
    onContinue: (
      target: { agentId?: string; configId?: string; value?: string },
      instructions: string,
    ) => void;
  } = $props();

  const models = $derived((modelOption?.options ?? []).filter((o) => o.value !== modelOption?.currentValue));
  const ready = $derived(agents.filter((a) => a.state === "ready"));

  let nextModel = $state("");
  let nextAgent = $state("");
  let instructions = $state("");

  const title = $derived(
    item.limitKind === "usage_limit"
      ? "Usage limit reached"
      : item.limitKind === "auth"
        ? "The agent needs you to sign in again"
        : "That model isn't available",
  );
</script>

<div class="limit-card">
  <div class="head">
    <AlertTriangle size={15} />
    <strong>{title}</strong>
    {#if item.resetHint}<span class="hint">{item.resetHint}</span>{/if}
  </div>
  <p class="message">{item.message}</p>

  {#if models.length > 0}
    <div class="row">
      <Cpu size={14} />
      <select bind:value={nextModel} disabled={disabled}>
        <option value="">Switch model…</option>
        {#each models as model (model.value)}
          <option value={model.value}>{model.name ?? model.value}</option>
        {/each}
      </select>
      <button
        class="primary"
        disabled={disabled || !nextModel}
        onclick={() => nextModel && onSwitchModel(nextModel)}>Use model</button
      >
    </div>
  {/if}

  {#if ready.length > 0}
    <div class="row">
      <ArrowRightLeft size={14} />
      <select bind:value={nextAgent} disabled={disabled}>
        <option value="">Continue on another agent…</option>
        {#each ready as agent (agent.id)}
          <option value={agent.id}>{agent.name}</option>
        {/each}
      </select>
      <input bind:value={instructions} placeholder="Optional instructions for the new agent" disabled={disabled} />
      <button
        class="primary"
        disabled={disabled || !nextAgent}
        onclick={() => nextAgent && onContinue({ agentId: nextAgent }, instructions)}>Continue</button
      >
    </div>
  {/if}

  {#if models.length === 0 && ready.length === 0}
    <p class="empty">Connect another agent in Settings, or wait for the limit to reset.</p>
  {/if}
</div>

<style>
  .limit-card {
    border: 1px solid #7c2d12;
    background: #2a120b;
    color: #fed7aa;
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    margin-left: auto;
    opacity: 0.75;
  }
  .message {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    opacity: 0.85;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  select,
  input {
    background: #1c0f0a;
    color: inherit;
    border: 1px solid #7c2d12;
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 12px;
    min-width: 0;
  }
  input {
    flex: 1;
  }
  button {
    border: 1px solid #7c2d12;
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary {
    background: #c2410c;
    border-color: #c2410c;
    color: #fff;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .empty {
    margin: 0;
    opacity: 0.8;
  }
</style>
