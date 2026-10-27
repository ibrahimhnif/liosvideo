<script lang="ts">
  import type { CommitInfo, FileDiff, HistoryApi, HistoryStatus } from "$lib/history/api";
  import { diffLines } from "$lib/history/diff";

  let { status, api, onStatus }: { status: HistoryStatus; api: HistoryApi; onStatus: (s: HistoryStatus) => void } = $props();

  const LIMIT = 200;
  let commits = $state<CommitInfo[]>([]);
  let openId = $state<string | undefined>();
  let files = $state<FileDiff[]>([]);
  let confirming = $state(false);
  let message = $state("");
  let error = $state("");

  async function run(action: () => Promise<unknown>) {
    error = "";
    try {
      await action();
    } catch (e) {
      error = String(e);
    }
  }

  const reload = () => run(async () => (commits = await api.history(LIMIT)));

  $effect(() => {
    if (status.kind !== "enabled") return;
    reload();
    return api.onCommitted(reload);
  });

  function show(c: CommitInfo) {
    confirming = false;
    if (openId === c.id) return void (openId = undefined);
    openId = c.id;
    files = [];
    run(async () => (files = await api.diff(c.id)));
  }

  const enable = () => run(async () => onStatus(await api.enable()));
  const checkpoint = () =>
    run(async () => {
      await api.checkpoint(message);
      message = "";
      await reload();
    });
  const restore = (id: string) =>
    run(async () => {
      confirming = false;
      await api.restore(id);
      await reload();
    });

  function ago(time: number): string {
    const s = Math.max(0, Math.round(Date.now() / 1000 - time));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(time * 1000).toLocaleDateString();
  }
</script>

<aside class="history">
  <header>History</header>
  {#if status.kind === "off"}
    <p class="note">History is off for this folder.</p>
    <button class="primary" onclick={enable}>Enable history</button>
  {:else if status.kind === "unmanaged"}
    <p class="note">This folder is already a git repository. If liosvideo manages its history, it will commit changes here on your current branch.</p>
    <button class="primary" onclick={enable}>Manage history here</button>
  {:else if status.kind === "nested"}
    <p class="note">This folder is inside another git repository ({status.repo}). History is disabled.</p>
  {:else}
    <form class="checkpoint" onsubmit={(e) => (e.preventDefault(), checkpoint())}>
      <input placeholder="Checkpoint message" bind:value={message} />
      <button type="submit">Checkpoint</button>
    </form>
    <ul>
      {#each commits as c (c.id)}
        <li class:open={openId === c.id}>
          <button class="commit" onclick={() => show(c)}>
            <span class="summary">{c.summary}</span>
            <span class="meta">{c.shortId} · {ago(c.time)}</span>
          </button>
          {#if openId === c.id}
            <div class="detail">
              {#if confirming}
                <div class="actions">
                  <button class="danger" onclick={() => restore(c.id)}>Confirm restore</button>
                  <button onclick={() => (confirming = false)}>Cancel</button>
                </div>
              {:else if c.id !== commits[0]?.id}
                <div class="actions"><button onclick={() => (confirming = true)}>Restore to here</button></div>
              {/if}
              {#each files as f (f.path)}
                <div class="file">
                  <div class="path"><span class="status {f.status}">{f.status}</span> {f.path}</div>
                  {#if f.binary}
                    <div class="note">binary file</div>
                  {:else}
                    <pre>{#each diffLines(f.patch) as l, i (i)}<span class="line {l.kind}">{l.text}</span>{"\n"}{/each}</pre>
                    {#if f.truncated}<div class="note">diff truncated</div>{/if}
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="error">{error}</p>{/if}
</aside>

<style>
  .history { display: flex; flex-direction: column; min-height: 0; height: 100%; border-left: 1px solid var(--border); background: var(--panel); }
  header { height: 32px; display: flex; align-items: center; padding: 0 12px; font-weight: 600; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .note { color: var(--muted); margin: 8px 12px; font-size: 12px; }
  .error { color: var(--danger); margin: 8px 12px; font-size: 12px; }
  button { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  .primary { margin: 0 12px; align-self: flex-start; }
  .danger { color: var(--danger); }
  .checkpoint { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .checkpoint input { flex: 1; min-width: 0; font: inherit; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
  ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
  li { border-bottom: 1px solid var(--border); }
  .commit { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; border: none; border-radius: 0; background: none; padding: 8px 12px; text-align: left; }
  li.open .commit { background: var(--raised); }
  .summary { font-weight: 500; }
  .meta { color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; }
  .detail { padding: 6px 12px 10px; }
  .actions { display: flex; gap: 6px; margin-bottom: 8px; }
  .file { margin-top: 6px; }
  .path { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
  .status { text-transform: uppercase; font-size: 9px; padding: 1px 4px; border-radius: 3px; background: var(--raised); color: var(--muted); }
  .status.added { color: #2e9d57; }
  .status.deleted { color: var(--danger); }
  pre { margin: 4px 0 0; padding: 6px; font-size: 11px; line-height: 1.4; background: var(--bg); border-radius: 4px; overflow-x: auto; }
  .line.add { color: #2e9d57; }
  .line.del { color: var(--danger); }
  .line.hunk { color: #4f8cff; }
  .line.meta { color: var(--muted); }
</style>
