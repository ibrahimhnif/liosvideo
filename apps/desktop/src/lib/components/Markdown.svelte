<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { renderMarkdown } from "$lib/chat/markdown";

  let { content = "" }: { content: string } = $props();

  let html = $derived(renderMarkdown(content));

  function handleClick(e: MouseEvent) {
    const target = (e.target as HTMLElement)?.closest?.("a");
    if (target && target.href) {
      e.preventDefault();
      try {
        openUrl(target.href).catch(() => {
          window.open(target.href, "_blank", "noopener,noreferrer");
        });
      } catch {
        window.open(target.href, "_blank", "noopener,noreferrer");
      }
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="markdown-body" onclick={handleClick}>
  {@html html}
</div>

<style>
  .markdown-body {
    word-break: break-word;
    white-space: normal;
    font-size: 13px;
    line-height: 1.55;
    color: inherit;
  }

  .markdown-body :global(> *:first-child) {
    margin-top: 0;
  }

  .markdown-body :global(> *:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(p) {
    margin: 0.35em 0;
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4) {
    font-weight: 600;
    margin: 0.6em 0 0.3em 0;
    color: var(--fg);
    line-height: 1.3;
  }

  .markdown-body :global(h1) { font-size: 1.25em; }
  .markdown-body :global(h2) { font-size: 1.15em; }
  .markdown-body :global(h3) { font-size: 1.05em; }
  .markdown-body :global(h4) { font-size: 0.95em; }

  .markdown-body :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    padding: 0.15em 0.35em;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    color: #79c0ff;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .markdown-body :global(pre) {
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 0.5em 0;
  }

  .markdown-body :global(pre code) {
    background: transparent;
    border: none;
    padding: 0;
    font-size: 11.5px;
    line-height: 1.45;
    color: #e6edf3;
    display: block;
    white-space: pre;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin: 0.35em 0;
    padding-left: 1.35em;
  }

  .markdown-body :global(li) {
    margin: 0.15em 0;
  }

  .markdown-body :global(blockquote) {
    margin: 0.4em 0;
    padding: 0 0.7em;
    color: var(--muted);
    border-left: 3px solid var(--border);
    font-style: italic;
  }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5em 0;
    font-size: 12px;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: var(--raised);
    font-weight: 600;
  }

  .markdown-body :global(a) {
    color: #58a6ff;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .markdown-body :global(a:hover) {
    color: #79c0ff;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.7em 0;
  }
</style>
