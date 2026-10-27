<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  let {
    open = false,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let elevenKey = $state("");
  let googleKey = $state("");
  let anthropicKey = $state("");
  let elevenConfigured = $state(false);
  let googleConfigured = $state(false);
  let anthropicConfigured = $state(false);
  let showEleven = $state(false);
  let showGoogle = $state(false);
  let showAnthropic = $state(false);
  let savingEleven = $state(false);
  let savingGoogle = $state(false);
  let savingAnthropic = $state(false);
  let message = $state<{ text: string; type: "success" | "error" } | null>(null);

  $effect(() => {
    if (open) {
      loadKeys();
    }
  });

  async function loadKeys() {
    message = null;
    try {
      const aKey = await invoke<string | null>("get_api_key", { service: "ANTHROPIC_API_KEY" });
      if (aKey) {
        anthropicKey = aKey;
        anthropicConfigured = true;
      } else {
        anthropicKey = "";
        anthropicConfigured = false;
      }

      const eKey = await invoke<string | null>("get_api_key", { service: "ELEVENLABS_API_KEY" });
      if (eKey) {
        elevenKey = eKey;
        elevenConfigured = true;
      } else {
        elevenKey = "";
        elevenConfigured = false;
      }

      const gKey = await invoke<string | null>("get_api_key", { service: "GOOGLE_TTS_API_KEY" });
      if (gKey) {
        googleKey = gKey;
        googleConfigured = true;
      } else {
        googleKey = "";
        googleConfigured = false;
      }
    } catch (err) {
      // In test/mock environments or if keychain lookup fails
    }
  }

  async function saveAnthropic() {
    if (!anthropicKey.trim()) return;
    savingAnthropic = true;
    message = null;
    try {
      await invoke("set_api_key", { service: "ANTHROPIC_API_KEY", key: anthropicKey.trim() });
      anthropicConfigured = true;
      message = { text: "Anthropic API key saved securely!", type: "success" };
    } catch (err) {
      message = { text: `Failed to save: ${err}`, type: "error" };
    } finally {
      savingAnthropic = false;
    }
  }

  async function clearAnthropic() {
    try {
      await invoke("delete_api_key", { service: "ANTHROPIC_API_KEY" });
      anthropicKey = "";
      anthropicConfigured = false;
      message = { text: "Anthropic API key removed.", type: "success" };
    } catch (err) {
      message = { text: `Failed to remove: ${err}`, type: "error" };
    }
  }

  async function saveEleven() {
    if (!elevenKey.trim()) return;
    savingEleven = true;
    message = null;
    try {
      await invoke("set_api_key", { service: "ELEVENLABS_API_KEY", key: elevenKey.trim() });
      elevenConfigured = true;
      message = { text: "ElevenLabs API key saved to macOS Keychain!", type: "success" };
    } catch (err) {
      message = { text: `Failed to save: ${err}`, type: "error" };
    } finally {
      savingEleven = false;
    }
  }

  async function clearEleven() {
    try {
      await invoke("delete_api_key", { service: "ELEVENLABS_API_KEY" });
      elevenKey = "";
      elevenConfigured = false;
      message = { text: "ElevenLabs API key removed from Keychain.", type: "success" };
    } catch (err) {
      message = { text: `Failed to remove: ${err}`, type: "error" };
    }
  }

  async function saveGoogle() {
    if (!googleKey.trim()) return;
    savingGoogle = true;
    message = null;
    try {
      await invoke("set_api_key", { service: "GOOGLE_TTS_API_KEY", key: googleKey.trim() });
      googleConfigured = true;
      message = { text: "Google Cloud TTS API key saved to macOS Keychain!", type: "success" };
    } catch (err) {
      message = { text: `Failed to save: ${err}`, type: "error" };
    } finally {
      savingGoogle = false;
    }
  }

  async function clearGoogle() {
    try {
      await invoke("delete_api_key", { service: "GOOGLE_TTS_API_KEY" });
      googleKey = "";
      googleConfigured = false;
      message = { text: "Google Cloud TTS API key removed from Keychain.", type: "success" };
    } catch (err) {
      message = { text: `Failed to remove: ${err}`, type: "error" };
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={(e) => e.target === e.currentTarget && onClose()} data-testid="settings-modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="header">
        <h2 id="settings-title">API Keys & TTS Settings</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close modal">×</button>
      </div>

      <div class="content">
        <p class="description">
          API keys are securely stored in your local <strong>macOS Keychain</strong>. They are never written to project files or pushed to Git.
        </p>

        {#if message}
          <div class="alert {message.type}">
            {message.text}
          </div>
        {/if}

        <!-- Anthropic (Claude Agent) -->
        <div class="field-group">
          <div class="label-row">
            <label for="anthropic-key">Anthropic API Key (Claude)</label>
            <span class="badge" class:configured={anthropicConfigured}>
              {anthropicConfigured ? "✓ Configured" : "Not Set"}
            </span>
          </div>
          <div class="input-row">
            <input
              id="anthropic-key"
              data-testid="input-anthropic"
              type={showAnthropic ? "text" : "password"}
              placeholder="sk-ant-api..."
              bind:value={anthropicKey}
            />
            <button
              type="button"
              class="icon-btn"
              onclick={() => (showAnthropic = !showAnthropic)}
              title={showAnthropic ? "Hide key" : "Show key"}
            >
              {showAnthropic ? "🙈" : "👁️"}
            </button>
            <button
              type="button"
              class="save-btn"
              disabled={savingAnthropic || !anthropicKey.trim()}
              onclick={saveAnthropic}
            >
              {savingAnthropic ? "Saving..." : "Save"}
            </button>
            {#if anthropicConfigured}
              <button type="button" class="clear-btn" onclick={clearAnthropic} title="Remove key">Clear</button>
            {/if}
          </div>
          <p class="field-hint">Allows Claude Agent ACP to operate directly with your API key, bypassing OAuth session expiration.</p>
        </div>

        <!-- ElevenLabs -->
        <div class="field-group">
          <div class="label-row">
            <label for="elevenlabs-key">ElevenLabs API Key</label>
            <span class="badge" class:configured={elevenConfigured}>
              {elevenConfigured ? "✓ Configured" : "Not Set"}
            </span>
          </div>
          <div class="input-row">
            <input
              id="elevenlabs-key"
              data-testid="input-elevenlabs"
              type={showEleven ? "text" : "password"}
              placeholder="sk_..."
              bind:value={elevenKey}
            />
            <button
              type="button"
              class="icon-btn"
              onclick={() => (showEleven = !showEleven)}
              title={showEleven ? "Hide key" : "Show key"}
            >
              {showEleven ? "🙈" : "👁️"}
            </button>
            <button
              type="button"
              class="save-btn"
              disabled={savingEleven || !elevenKey.trim()}
              onclick={saveEleven}
            >
              {savingEleven ? "Saving..." : "Save"}
            </button>
            {#if elevenConfigured}
              <button type="button" class="clear-btn" onclick={clearEleven} title="Remove key">Clear</button>
            {/if}
          </div>
          <p class="field-hint">Used for live voice narration synthesis with word-level alignment timestamps.</p>
        </div>

        <!-- Google Cloud TTS -->
        <div class="field-group">
          <div class="label-row">
            <label for="google-tts-key">Google Cloud TTS API Key</label>
            <span class="badge" class:configured={googleConfigured}>
              {googleConfigured ? "✓ Configured" : "Not Set"}
            </span>
          </div>
          <div class="input-row">
            <input
              id="google-tts-key"
              data-testid="input-google"
              type={showGoogle ? "text" : "password"}
              placeholder="AIza..."
              bind:value={googleKey}
            />
            <button
              type="button"
              class="icon-btn"
              onclick={() => (showGoogle = !showGoogle)}
              title={showGoogle ? "Hide key" : "Show key"}
            >
              {showGoogle ? "🙈" : "👁️"}
            </button>
            <button
              type="button"
              class="save-btn"
              disabled={savingGoogle || !googleKey.trim()}
              onclick={saveGoogle}
            >
              {savingGoogle ? "Saving..." : "Save"}
            </button>
            {#if googleConfigured}
              <button type="button" class="clear-btn" onclick={clearGoogle} title="Remove key">Clear</button>
            {/if}
          </div>
          <p class="field-hint">Used for Journey and Neural2 voices from Google Cloud Text-to-Speech.</p>
        </div>
      </div>

      <div class="footer">
        <button class="done-btn" onclick={onClose}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    width: 520px;
    max-width: 90vw;
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    color: #c9d1d9;
    font-size: 13px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #30363d;
  }

  .header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #f0f6fc;
  }

  .close-btn {
    background: none;
    border: none;
    color: #8b949e;
    font-size: 20px;
    cursor: pointer;
    line-height: 1;
    padding: 4px;
  }

  .close-btn:hover {
    color: #f0f6fc;
  }

  .content {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .description {
    margin: 0;
    color: #8b949e;
    line-height: 1.4;
    font-size: 12px;
  }

  .alert {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .alert.success {
    background: rgba(46, 160, 67, 0.15);
    border: 1px solid #2ea043;
    color: #3fb950;
  }

  .alert.error {
    background: rgba(248, 81, 73, 0.15);
    border: 1px solid #f85149;
    color: #ff7b72;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .label-row label {
    font-weight: 500;
    color: #f0f6fc;
  }

  .badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #21262d;
    color: #8b949e;
  }

  .badge.configured {
    background: rgba(46, 160, 67, 0.2);
    color: #3fb950;
  }

  .input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .input-row input {
    flex: 1;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 7px 10px;
    color: #c9d1d9;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }

  .input-row input:focus {
    outline: none;
    border-color: #58a6ff;
  }

  .icon-btn {
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
  }

  .save-btn {
    background: #238636;
    border: 1px solid rgba(240, 246, 252, 0.1);
    border-radius: 6px;
    color: #ffffff;
    padding: 7px 14px;
    font-weight: 500;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
  }

  .save-btn:hover:not(:disabled) {
    background: #2ea043;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .clear-btn {
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #f85149;
    padding: 7px 10px;
    cursor: pointer;
    font-size: 12px;
  }

  .clear-btn:hover {
    background: rgba(248, 81, 73, 0.1);
  }

  .field-hint {
    margin: 0;
    font-size: 11px;
    color: #8b949e;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid #30363d;
    background: #0d1117;
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
  }

  .done-btn {
    background: #30363d;
    border: 1px solid #8b949e;
    border-radius: 6px;
    color: #f0f6fc;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
  }

  .done-btn:hover {
    background: #484f58;
  }
</style>
