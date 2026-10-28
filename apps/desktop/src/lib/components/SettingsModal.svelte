<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import {
    Check,
    Cpu,
    Eye,
    EyeOff,
    KeyRound,
    RotateCcw,
    Trash2,
    X,
  } from "@lucide/svelte";
  import Probe from "$lib/probe/Probe.svelte";

  let {
    open = false,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let activeTab = $state<"keys" | "probe">("keys");
  let elevenKey = $state("");
  let elevenVoiceId = $state("");
  let defaultTtsVoice = $state("id-ID-Neural2-A");
  let googleKey = $state("");
  let anthropicKey = $state("");
  let elevenConfigured = $state(false);
  let elevenVoiceIdConfigured = $state(false);
  let googleConfigured = $state(false);
  let anthropicConfigured = $state(false);
  let showEleven = $state(false);
  let showGoogle = $state(false);
  let showAnthropic = $state(false);
  let savingEleven = $state(false);
  let savingVoiceId = $state(false);
  let savingDefaultVoice = $state(false);
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

      const vId = await invoke<string | null>("get_api_key", { service: "ELEVENLABS_VOICE_ID" });
      if (vId) {
        elevenVoiceId = vId;
        elevenVoiceIdConfigured = true;
      } else {
        elevenVoiceId = "";
        elevenVoiceIdConfigured = false;
      }

      const defVoice = await invoke<string | null>("get_api_key", { service: "DEFAULT_TTS_VOICE" });
      if (defVoice) {
        defaultTtsVoice = defVoice;
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

  async function saveVoiceId() {
    if (!elevenVoiceId.trim()) return;
    savingVoiceId = true;
    message = null;
    try {
      await invoke("set_api_key", { service: "ELEVENLABS_VOICE_ID", key: elevenVoiceId.trim() });
      elevenVoiceIdConfigured = true;
      message = { text: "Voice ID suara pribadi disimpan!", type: "success" };
    } catch (err) {
      message = { text: `Gagal menyimpan Voice ID: ${err}`, type: "error" };
    } finally {
      savingVoiceId = false;
    }
  }

  async function clearVoiceId() {
    try {
      await invoke("delete_api_key", { service: "ELEVENLABS_VOICE_ID" });
      elevenVoiceId = "";
      elevenVoiceIdConfigured = false;
      message = { text: "Voice ID pribadi direset ke suara bawaan.", type: "success" };
    } catch (err) {
      message = { text: `Gagal mereset: ${err}`, type: "error" };
    }
  }

  async function saveDefaultVoice() {
    savingDefaultVoice = true;
    message = null;
    try {
      await invoke("set_api_key", { service: "DEFAULT_TTS_VOICE", key: defaultTtsVoice });
      message = { text: `Default voice diatur ke: ${defaultTtsVoice}`, type: "success" };
    } catch (err) {
      message = { text: `Gagal menyimpan default voice: ${err}`, type: "error" };
    } finally {
      savingDefaultVoice = false;
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
        <h2 id="settings-title">
          <KeyRound size={16} />
          <span>API Keys & TTS Settings</span>
        </h2>
        <button class="close-btn" onclick={onClose} aria-label="Close modal">
          <X size={16} />
        </button>
      </div>

      <div class="tabs">
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === "keys"}
          onclick={() => (activeTab = "keys")}
        >
          <KeyRound size={13} />
          <span>API Keys & TTS</span>
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === "probe"}
          onclick={() => (activeTab = "probe")}
        >
          <Cpu size={13} />
          <span>Compatibility Probe</span>
        </button>
      </div>

      <div class="content">
        {#if activeTab === "probe"}
          <Probe />
        {:else}
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
                {#if anthropicConfigured}
                  <Check size={11} />
                  <span>Configured</span>
                {:else}
                  <span>Not Set</span>
                {/if}
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
                aria-label={showAnthropic ? "Hide key" : "Show key"}
              >
                {#if showAnthropic}
                  <EyeOff size={14} />
                {:else}
                  <Eye size={14} />
                {/if}
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
                <button type="button" class="clear-btn" onclick={clearAnthropic} title="Remove key">
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              {/if}
            </div>
            <p class="field-hint">Allows Claude Agent ACP to operate directly with your API key, bypassing OAuth session expiration.</p>
          </div>

          <!-- ElevenLabs -->
          <div class="field-group">
            <div class="label-row">
              <label for="elevenlabs-key">ElevenLabs API Key</label>
              <span class="badge" class:configured={elevenConfigured}>
                {#if elevenConfigured}
                  <Check size={11} />
                  <span>Configured</span>
                {:else}
                  <span>Not Set</span>
                {/if}
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
                aria-label={showEleven ? "Hide key" : "Show key"}
              >
                {#if showEleven}
                  <EyeOff size={14} />
                {:else}
                  <Eye size={14} />
                {/if}
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
                <button type="button" class="clear-btn" onclick={clearEleven} title="Remove key">
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              {/if}
            </div>
            <p class="field-hint">Used for live voice narration synthesis with word-level alignment timestamps.</p>
          </div>

          <!-- ElevenLabs Voice ID (Suara Pribadi / Clone) -->
          <div class="field-group">
            <div class="label-row">
              <label for="eleven-voice-id">ElevenLabs Voice ID (Suara Pribadi / Clone)</label>
              <span class="badge" class:configured={elevenVoiceIdConfigured}>
                {#if elevenVoiceIdConfigured}
                  <Check size={11} />
                  <span>Configured</span>
                {:else}
                  <span>Default (Rachel)</span>
                {/if}
              </span>
            </div>
            <div class="input-row">
              <input
                id="eleven-voice-id"
                data-testid="input-voice-id"
                type="text"
                placeholder="e.g. Voice ID kloningan dari ElevenLabs VoiceLab"
                bind:value={elevenVoiceId}
              />
              <button
                type="button"
                class="save-btn"
                disabled={savingVoiceId || !elevenVoiceId.trim()}
                onclick={saveVoiceId}
              >
                {savingVoiceId ? "Saving..." : "Save"}
              </button>
              {#if elevenVoiceIdConfigured}
                <button type="button" class="clear-btn" onclick={clearVoiceId} title="Reset">
                  <RotateCcw size={12} />
                  <span>Reset</span>
                </button>
              {/if}
            </div>
            <p class="field-hint">
              Masukkan Voice ID dari kloningan suara Anda di ElevenLabs. Model <code>eleven_multilingual_v2</code> otomatis membaca naskah Bahasa Indonesia dengan suara Anda!
            </p>
          </div>

          <!-- Google Cloud TTS -->
          <div class="field-group">
            <div class="label-row">
              <label for="google-tts-key">Google Cloud TTS API Key</label>
              <span class="badge" class:configured={googleConfigured}>
                {#if googleConfigured}
                  <Check size={11} />
                  <span>Configured</span>
                {:else}
                  <span>Not Set</span>
                {/if}
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
                aria-label={showGoogle ? "Hide key" : "Show key"}
              >
                {#if showGoogle}
                  <EyeOff size={14} />
                {:else}
                  <Eye size={14} />
                {/if}
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
                <button type="button" class="clear-btn" onclick={clearGoogle} title="Remove key">
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              {/if}
            </div>
            <p class="field-hint">Used for Journey and Neural2 voices from Google Cloud Text-to-Speech.</p>
          </div>

          <!-- Default Voice & Language -->
          <div class="field-group">
            <div class="label-row">
              <label for="default-tts-voice">Default Voice & Bahasa Narasi</label>
              <span class="badge configured">Active</span>
            </div>
            <div class="input-row">
              <select
                id="default-tts-voice"
                data-testid="select-default-voice"
                class="voice-select"
                bind:value={defaultTtsVoice}
                onchange={saveDefaultVoice}
              >
                <optgroup label="🇮🇩 Bahasa Indonesia (Google Cloud TTS)">
                  <option value="id-ID-Neural2-A">id-ID-Neural2-A (Wanita, Alami & Jernih)</option>
                  <option value="id-ID-Neural2-B">id-ID-Neural2-B (Pria, Formal & Natural)</option>
                  <option value="id-ID-Wavenet-A">id-ID-Wavenet-A (Wanita Wavenet)</option>
                  <option value="id-ID-Wavenet-B">id-ID-Wavenet-B (Pria Wavenet)</option>
                  <option value="id-ID-Wavenet-D">id-ID-Wavenet-D (Wanita Wavenet 2)</option>
                </optgroup>
                <optgroup label="✨ ElevenLabs (Multilingual & Suara Pribadi)">
                  <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Calm & Professional, Multilingual)</option>
                  <option value="pNInz6obpgDQGcFmaJgB">Adam (Deep & Narrator, Multilingual)</option>
                  <option value="ErXwobaYiN019PkySvjV">Antoni (Natural & Crisp, Multilingual)</option>
                  <option value="EXAVITQu4vr4xnSDxMaL">Bella (Expressive & Warm, Multilingual)</option>
                </optgroup>
                <optgroup label="🇺🇸 English (Google Cloud TTS)">
                  <option value="en-US-Journey-F">en-US-Journey-F (Female Journey)</option>
                  <option value="en-US-Journey-D">en-US-Journey-D (Male Journey)</option>
                </optgroup>
              </select>
            </div>
            <p class="field-hint">Suara bawaan yang digunakan untuk mensintesis narasi video.</p>
          </div>
        {/if}
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
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: 580px;
    max-width: calc(100vw - 32px);
    max-height: 85vh;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    color: var(--fg);
    font-size: 13px;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .header h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: var(--fg);
    background: var(--raised);
  }

  .tabs {
    display: flex;
    gap: 6px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 12px;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -1px;
    transition: all 0.15s ease;
  }

  .tab-btn:hover {
    color: var(--fg);
  }

  .tab-btn.active {
    color: #4f8cff;
    border-bottom-color: #4f8cff;
  }

  .content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 18px;
    background: var(--panel);
  }

  .description {
    margin: 0;
    color: var(--muted);
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
    border: 1px solid rgba(46, 160, 67, 0.35);
    color: #3fb950;
  }

  .alert.error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: var(--danger);
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
    color: var(--fg);
  }

  .badge {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .badge.configured {
    background: rgba(46, 160, 67, 0.15);
    border-color: rgba(46, 160, 67, 0.35);
    color: #3fb950;
  }

  .input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .input-row input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
    color: var(--fg);
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }

  .input-row input:focus {
    outline: none;
    border-color: #4f8cff;
  }

  .voice-select {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 10px;
    color: var(--fg);
    font-size: 12px;
  }

  .voice-select:focus {
    outline: none;
    border-color: #4f8cff;
  }

  .icon-btn {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    color: var(--fg);
    border-color: var(--muted);
  }

  .save-btn {
    background: #2e9d57;
    border: 1px solid #2e9d57;
    border-radius: 6px;
    color: #ffffff;
    padding: 7px 14px;
    font-weight: 500;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.15s;
  }

  .save-btn:hover:not(:disabled) {
    background: #27854a;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .clear-btn {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--danger);
    padding: 6px 9px;
    cursor: pointer;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .clear-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--danger);
  }

  .field-hint {
    margin: 0;
    font-size: 11px;
    color: var(--muted);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    background: var(--panel);
  }

  .done-btn {
    background: #4f8cff;
    border: none;
    border-radius: 6px;
    color: #ffffff;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s ease;
  }

  .done-btn:hover {
    background: #3b76e1;
  }
</style>
