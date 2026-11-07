<script lang="ts">
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { Check, Copy, ImagePlus, Loader2, RefreshCw, Sparkles, Wand2 } from "@lucide/svelte";

  type Version = {
    n: number;
    file: string;
    prompt: string;
    from?: number;
    model: string;
    aspect: string;
    refs?: string[];
    createdAt: number;
  };
  type Entry = { id: string; src: string; active: number; versions: Version[] };
  type Studio = { images: Entry[]; defaultAspect: string; aspects: string[]; hasKey: boolean };

  let { projectRoot }: { projectRoot?: string } = $props();

  let studio = $state<Studio>({ images: [], defaultAspect: "16:9", aspects: [], hasKey: true });
  let selectedId = $state<string | null>(null);
  let viewing = $state<number | null>(null);
  let mode = $state<"new" | "detail">("new");
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);
  let urls = $state<Record<string, string>>({});

  let prompt = $state("");
  let newId = $state("");
  let aspect = $state("");
  let instruction = $state("");

  const QUICK = ["Brighter", "Darker, moodier", "Less clutter", "Remove any text", "More cinematic", "Warmer colours"];

  let selected = $derived(studio.images.find((e) => e.id === selectedId) ?? null);
  let shown = $derived(
    selected ? (selected.versions.find((v) => v.n === (viewing ?? selected.active)) ?? null) : null,
  );
  let usage = $derived(selected ? `image({ src: "${selected.src}", fit: "cover" })` : "");

  function slug(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 4)
      .join("-");
  }

  async function url(file: string) {
    if (urls[file]) return;
    try {
      const path = await invoke<string>("asset_url_path", { rel: file });
      urls = { ...urls, [file]: convertFileSrc(path) };
    } catch {
      // missing file: the thumbnail just stays empty
    }
  }

  async function load() {
    try {
      studio = await invoke<Studio>("image_list");
      if (!aspect) aspect = studio.defaultAspect;
      for (const entry of studio.images) for (const v of entry.versions) url(v.file);
      if (selectedId && !studio.images.some((e) => e.id === selectedId)) selectedId = null;
    } catch (err) {
      error = String(err);
    }
  }

  function open(entry: Entry) {
    selectedId = entry.id;
    viewing = null;
    mode = "detail";
    error = null;
  }

  function startNew() {
    mode = "new";
    selectedId = null;
    error = null;
  }

  async function run(label: string, task: () => Promise<Entry>) {
    busy = label;
    error = null;
    try {
      const entry = await task();
      await load();
      open(entry);
    } catch (err) {
      error = String(err);
    } finally {
      busy = null;
    }
  }

  function generate() {
    const id = newId.trim() || slug(prompt);
    if (!prompt.trim() || !id) return;
    run("Generating…", () => invoke<Entry>("image_generate", { prompt: prompt.trim(), id, aspect: aspect || null }));
  }

  function revise(text = instruction) {
    if (!selected || !text.trim()) return;
    const id = selected.id;
    run("Revising…", async () => {
      const entry = await invoke<Entry>("image_edit", { id, instruction: text.trim() });
      instruction = "";
      return entry;
    });
  }

  function useVersion(n: number) {
    if (!selected) return;
    const id = selected.id;
    run("Switching…", () => invoke<Entry>("image_use_version", { id, version: n }));
  }

  async function copyUsage() {
    try {
      await navigator.clipboard.writeText(usage);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // clipboard blocked; the snippet is still visible to copy by hand
    }
  }

  // reload when another project opens (and once on mount)
  $effect(() => {
    void projectRoot;
    load();
  });
</script>

<div class="studio">
  <div class="toolbar">
    <div class="toolbar-left">
      <Sparkles size={14} class="icon-spark" />
      <span class="title">Images</span>
      <span class="pill">{studio.images.length} generated</span>
    </div>
    <div class="toolbar-right">
      <button class="tool-btn" onclick={startNew} data-testid="new-image"><ImagePlus size={13} /> New image</button>
      <button class="tool-btn" onclick={load} title="Reload (picks up images the agent made)"><RefreshCw size={13} /></button>
    </div>
  </div>

  {#if !studio.hasKey}
    <div class="banner" data-testid="no-key">Add a Gemini API key in Settings to generate images.</div>
  {/if}

  <div class="body">
    <aside class="list">
      {#each studio.images as entry (entry.id)}
        {@const active = entry.versions.find((v) => v.n === entry.active)}
        <button class="item" class:selected={entry.id === selectedId} onclick={() => open(entry)}>
          <div class="thumb">
            {#if active && urls[active.file]}<img src={urls[active.file]} alt={entry.id} />{/if}
          </div>
          <div class="meta">
            <span class="id">{entry.id}</span>
            <span class="sub">v{entry.active} · {entry.versions.length} version{entry.versions.length === 1 ? "" : "s"}</span>
          </div>
        </button>
      {:else}
        <p class="empty">No images yet. Describe one on the right, or ask the agent to use image_generate.</p>
      {/each}
    </aside>

    <section class="main">
      {#if mode === "new" || !selected}
        <div class="form">
          <h3>New image</h3>
          <label for="img-prompt">What should it show?</label>
          <textarea
            id="img-prompt"
            data-testid="prompt"
            rows="5"
            placeholder="e.g. The National Palace of El Salvador at dusk, low angle, cinematic, muted documentary colours, no text"
            bind:value={prompt}
          ></textarea>
          <div class="row">
            <div class="field">
              <label for="img-id">Asset id</label>
              <input id="img-id" data-testid="id" placeholder={slug(prompt) || "palace-dusk"} bind:value={newId} />
            </div>
            <div class="field">
              <label for="img-aspect">Aspect</label>
              <select id="img-aspect" bind:value={aspect}>
                {#each studio.aspects as a}<option value={a}>{a}</option>{/each}
              </select>
            </div>
          </div>
          <p class="hint">Saved as <code>assets/images/{newId.trim() || slug(prompt) || "<id>"}.png</code>. For real people and events prefer real photos; generate illustrations, backgrounds and reconstructions.</p>
          <button class="primary" data-testid="generate" disabled={!!busy || !prompt.trim()} onclick={generate}>
            {#if busy}<Loader2 size={14} class="spin" /> {busy}{:else}<Sparkles size={14} /> Generate{/if}
          </button>
        </div>
      {:else}
        <div class="detail">
          <div class="preview" style:aspect-ratio={shown?.aspect.replace(":", " / ")}>
            {#if shown && urls[shown.file]}<img src={urls[shown.file]} alt={selected.id} />{/if}
            {#if busy}<div class="veil"><Loader2 size={22} class="spin" /> {busy}</div>{/if}
          </div>

          <div class="versions">
            {#each selected.versions as v (v.n)}
              <button
                class="version"
                class:viewing={v.n === (viewing ?? selected.active)}
                title={v.prompt}
                onclick={() => (viewing = v.n)}
              >
                {#if urls[v.file]}<img src={urls[v.file]} alt="v{v.n}" />{/if}
                <span class="tag">v{v.n}{v.n === selected.active ? " ✓" : ""}</span>
              </button>
            {/each}
          </div>

          {#if shown}
            <p class="prompt-line">
              <strong>{shown.from ? `v${shown.n} — revised from v${shown.from}:` : `v${shown.n} — prompt:`}</strong>
              {shown.prompt}
            </p>
            {#if shown.n !== selected.active}
              <button class="secondary" data-testid="use-version" disabled={!!busy} onclick={() => useVersion(shown.n)}>
                Use v{shown.n} in the video
              </button>
            {/if}
          {/if}

          <div class="revise">
            <label for="img-revise">What should change?</label>
            <div class="chips">
              {#each QUICK as q}
                <button class="chip" disabled={!!busy} onclick={() => revise(q)}>{q}</button>
              {/each}
            </div>
            <textarea
              id="img-revise"
              data-testid="instruction"
              rows="3"
              placeholder="e.g. sky darker, fewer people in the background, less saturated, move the building to the left"
              bind:value={instruction}
              onkeydown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && revise()}
            ></textarea>
            <button class="primary" data-testid="revise" disabled={!!busy || !instruction.trim()} onclick={() => revise()}>
              <Wand2 size={14} /> Revise (new version)
            </button>
          </div>

          <div class="usage">
            <code>{usage}</code>
            <button class="tool-btn" onclick={copyUsage} title="Copy">
              {#if copied}<Check size={13} />{:else}<Copy size={13} />{/if}
            </button>
          </div>
        </div>
      {/if}

      {#if error}<p class="error" data-testid="error">{error}</p>{/if}
    </section>
  </div>
</div>

<style>
  .studio {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--panel);
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--raised);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 12px;
  }
  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  :global(.icon-spark) {
    color: #e0af68;
  }
  .title {
    font-weight: 600;
    font-size: 13px;
    color: var(--fg);
  }
  .pill {
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    padding: 2px 7px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: inherit;
    font-size: 12px;
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: var(--fg);
    cursor: pointer;
  }
  .tool-btn:hover {
    background: color-mix(in srgb, var(--fg) 6%, var(--panel));
  }
  .banner {
    padding: 8px 16px;
    font-size: 12px;
    color: #e0af68;
    background: color-mix(in srgb, #e0af68 10%, transparent);
    border-bottom: 1px solid var(--border);
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .list {
    width: 240px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .item {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }
  .item.selected {
    border-color: color-mix(in srgb, #7aa2f7 50%, transparent);
    background: color-mix(in srgb, #7aa2f7 10%, transparent);
  }
  .thumb {
    width: 52px;
    height: 52px;
    flex-shrink: 0;
    border-radius: 6px;
    overflow: hidden;
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .thumb img,
  .version img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .id {
    font-size: 12px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub,
  .empty,
  .hint {
    font-size: 11px;
    color: var(--muted);
  }
  .empty {
    padding: 8px;
    line-height: 1.5;
  }
  .main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 20px 24px;
  }
  .form,
  .detail {
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 15px;
    color: var(--fg);
  }
  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
  }
  textarea,
  input,
  select {
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    resize: vertical;
  }
  textarea:focus,
  input:focus,
  select:focus {
    outline: none;
    border-color: #7aa2f7;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }
  .primary,
  .secondary {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 14px;
    border-radius: 8px;
    cursor: pointer;
  }
  .primary {
    border: none;
    background: #7aa2f7;
    color: #0b0d12;
  }
  .secondary {
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--fg);
  }
  .primary:disabled,
  .secondary:disabled,
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .preview {
    position: relative;
    width: 100%;
    max-height: 56vh;
    border-radius: 10px;
    overflow: hidden;
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    display: flex;
    justify-content: center;
  }
  .preview img {
    height: 100%;
    max-width: 100%;
    object-fit: contain;
  }
  .veil {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #fff;
    font-size: 13px;
    background: rgb(0 0 0 / 0.5);
  }
  .versions {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .version {
    position: relative;
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    cursor: pointer;
  }
  .version.viewing {
    border-color: #7aa2f7;
  }
  .tag {
    position: absolute;
    left: 3px;
    bottom: 3px;
    font-size: 10px;
    font-weight: 700;
    color: #fff;
    background: rgb(0 0 0 / 0.65);
    padding: 1px 4px;
    border-radius: 4px;
  }
  .prompt-line {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }
  .prompt-line strong {
    color: var(--fg);
  }
  .revise {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font: inherit;
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--fg);
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-color: #7aa2f7;
  }
  .usage {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--raised);
    border: 1px solid var(--border);
  }
  .usage code {
    flex: 1;
    font-size: 12px;
    overflow-x: auto;
    white-space: nowrap;
  }
  .error {
    margin-top: 12px;
    font-size: 12px;
    color: #f7768e;
    white-space: pre-wrap;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
