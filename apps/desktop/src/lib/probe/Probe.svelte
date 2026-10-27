<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { blockingFailures, probeCapabilities, type Capabilities } from "./capabilities";

  let caps = $state<Capabilities | null>(null);

  onMount(async () => {
    caps = await probeCapabilities();
    const line = `capabilities ${JSON.stringify(caps)} ua=${navigator.userAgent}`;
    console.log(line);
    invoke("dev_log", { message: line }).catch(() => {});
  });
</script>

<section class="probe">
  <h2>Capability probe</h2>
  {#if !caps}
    <p>Probing…</p>
  {:else}
    <table>
      <tbody>
        {#each Object.entries(caps) as [name, ok]}
          <tr><td>{name}</td><td class:ok class:bad={!ok}>{ok ? "yes" : "no"}</td></tr>
        {/each}
      </tbody>
    </table>
    {#if blockingFailures(caps).length}
      <p class="bad">Blocking: {blockingFailures(caps).join(", ")}</p>
    {/if}
  {/if}
</section>

<style>
  .probe { font: 13px system-ui; padding: 16px; }
  td { padding: 2px 12px 2px 0; }
  .ok { color: #2a2; }
  .bad { color: #d33; }
</style>
