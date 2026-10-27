<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import type { AgentApi, AgentSettings, AgentStatus } from "$lib/chat/api";

  let { api }: { api: AgentApi } = $props();

  let agents = $state<AgentStatus[]>([]);
  let settings = $state<AgentSettings>({ projectAgents: {}, custom: [] });
  let logs = $state<Record<string, string[]>>({});
  let installing = $state<string | undefined>();
  let error = $state("");
  let form = $state({ name: "", command: "", args: "", env: "" });

  async function attempt(action: () => Promise<unknown>) {
    error = "";
    try {
      await action();
    } catch (e) {
      error = String(e);
    }
  }

  onMount(() =>
    attempt(async () => {
      [agents, settings] = await Promise.all([api.listAgents(), api.settings()]);
    }),
  );

  const rescan = () => attempt(async () => (agents = await api.rescan()));

  function install(a: AgentStatus) {
    installing = a.id;
    logs[a.id] = [];
    attempt(async () => {
      try {
        await api.install(a.id, (line) => (logs[a.id] = [...(logs[a.id] ?? []), line]));
      } finally {
        installing = undefined;
      }
      agents = await api.rescan();
    });
  }

  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function addCustom() {
    const env = Object.fromEntries(
      form.env.split("\n").map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
    const agent = { id: slug(form.name), name: form.name.trim(), command: form.command.trim(), args: form.args.split(/\s+/).filter(Boolean), env };
    attempt(async () => {
      settings = await api.addCustom(agent);
      form = { name: "", command: "", args: "", env: "" };
      agents = await api.rescan();
    });
  }
</script>

<div class="setup">
  <div class="head">
    <h3>Agents</h3>
    <button onclick={rescan}>Rescan</button>
  </div>
  <ul>
    {#each agents as a (a.id)}
      <li class={a.state}>
        {#if a.state === "ready"}
          <label class="pick">
            <input type="radio" name="default-agent" checked={settings.defaultAgent === a.id} onchange={() => attempt(async () => (settings = await api.setDefault(a.id)))} />
            <span class="name">{a.name}</span>
            {#if a.version}<span class="meta">{a.version}</span>{/if}
          </label>
          <button class="small" onclick={() => attempt(async () => (settings = await api.setProjectAgent(a.id)))}>Use for this project</button>
          {#if a.custom}<button class="small" onclick={() => attempt(async () => ((settings = await api.removeCustom(a.id)), (agents = await api.rescan())))}>Remove</button>{/if}
        {:else if a.state === "enable"}
          <span class="name">{a.name}</span>
          <span class="meta">adapter needed</span>
          <button aria-label="Enable {a.name}" disabled={installing !== undefined} onclick={() => install(a)}>{installing === a.id ? "Installing…" : "Enable"}</button>
        {:else}
          <span class="name">{a.name}</span>
          <span class="meta">not installed</span>
          {#if a.installUrl}
            <a href={a.installUrl} aria-label="Install {a.name}" onclick={(e) => (e.preventDefault(), openUrl(a.installUrl!))}>Install</a>
          {/if}
        {/if}
        {#if logs[a.id]?.length}<pre class="log">{logs[a.id].join("\n")}</pre>{/if}
      </li>
    {/each}
  </ul>
  <form class="custom" onsubmit={(e) => (e.preventDefault(), addCustom())}>
    <h4>Add custom agent</h4>
    <label>Name <input bind:value={form.name} /></label>
    <label>Command <input bind:value={form.command} placeholder="/path/to/agent" /></label>
    <label>Arguments <input bind:value={form.args} placeholder="--acp" /></label>
    <label>Environment <textarea rows="2" bind:value={form.env} placeholder="KEY=value"></textarea></label>
    <button type="submit" disabled={!form.name.trim() || !form.command.trim()}>Add agent</button>
  </form>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .setup { padding: 8px 12px; overflow-y: auto; flex: 1; min-height: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  h3 { margin: 4px 0; font-size: 13px; }
  h4 { margin: 12px 0 4px; font-size: 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
  li.not_installed .name { color: var(--muted); }
  .pick { display: flex; align-items: center; gap: 6px; flex: 1; }
  .name { font-weight: 500; }
  .meta { color: var(--muted); font-size: 11px; flex: 1; }
  button { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .small { font-size: 11px; padding: 2px 8px; }
  a { font-size: 12px; color: #4f8cff; }
  .log { width: 100%; margin: 0; max-height: 120px; overflow: auto; font-size: 10px; background: var(--bg); padding: 4px 6px; border-radius: 4px; }
  .custom { display: flex; flex-direction: column; gap: 6px; }
  .custom label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); }
  input, textarea { font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
  .error { color: var(--danger); font-size: 12px; }
</style>
