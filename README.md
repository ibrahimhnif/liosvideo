# liosvideo

> **Deterministic, code-first video platform powered by WebGPU, Web Audio, and WebCodecs, built for pair-programming with AI coding agents.**

---

## Overview

**liosvideo** turns technical video production into a software engineering workflow. Instead of clicking around a timeline in a heavy GUI video editor, videos are authored as pure, deterministic TypeScript code.

An AI coding agent (Claude Code, Gemini CLI, Codex, or custom ACP agents) researches topics, writes scripts, builds scenes, generates realistic app/desktop mockups, coordinates speech narration, and refines animations. The desktop app provides a live hot-reloading WebGPU preview, synchronized audio playback, scrubbable multi-track timeline, visual diff verification, and hardware-accelerated MP4 export.

---

## Key Features

- **Pure Deterministic Runtime (`@liosvideo/runtime`)**:
  - Declarative scene graph with nested transforms, anchors, clipping, opacity, blur, and custom easing curves.
  - Seeking to any frame produces the exact same pixels as real-time playback.
  - Scene Transitions: `fade`, `slide`, `zoom`, `wipe`.
- **Pixel-Perfect Realistic Mockups**:
  - Built-in components: macOS `desktop`, `window`, `chrome`, `terminal`, `editor` (VS Code style), `cursor`, `focus()` depth-of-field, and `phone` (9:16 mobile frame).
- **ACP (Agent Client Protocol) & Editor MCP Server**:
  - Connects to any ACP agent the user has installed.
  - Embedded MCP server gives the agent tools to inspect project state, capture rendered frames (`render_frame`), evaluate timelines, and synthesize narration.
  - Interactive chat stream cards for permissions, asset requests, and voice lines.
- **Narration & Speech Synchronization**:
  - Word-level audio alignment synchronization with `vo(id).wordTime(...)`.
  - Built-in TTS support (ElevenLabs live cloud, Google Cloud TTS, and mock offline engine).
  - In-app microphone recording with waveform visualizer and git checkpoints.
  - Secure API key management backed by macOS Keychain (`/usr/bin/security`).
- **Hardware-Accelerated MP4 Export**:
  - Offline frame rendering with WebCodecs H.264 video encoding.
  - Web Audio `OfflineAudioContext` mixdown with AAC encoding and `mp4-muxer`.
  - Resolution presets for 1080p, 4K, and 9:16 mobile formats.
- **Git-Tracked History**:
  - Automatic commits at the end of every agent turn and recording take.
  - Visual diff viewer and lossless "Restore to here" checkpointing.
  - Out-of-scope revision warning banner with one-click revert.

---

## Repository Structure

```
├── apps/
│   └── desktop/            # Tauri 2 + Svelte 5 desktop application
│       ├── src/            # Svelte frontend UI (preview, timeline, chat, export)
│       └── src-tauri/      # Rust backend (ACP client, MCP server, git, TTS, audio)
├── packages/
│   └── runtime/            # @liosvideo/runtime declarative TypeScript video engine
├── skills/
│   └── liosvideo/          # Universal ACP agent skill & director guide
├── AGENTS.md               # Universal guidance for AI coding agents
└── LICENSE                 # MIT License
```

---

## Getting Started

### Prerequisites

- **macOS** (Apple Silicon recommended)
- **Node.js** >= 20 and **pnpm** >= 9
- **Rust** >= 1.80

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/liosvideo.git
cd liosvideo

# Install dependencies
pnpm install

# Run tests across all workspaces
pnpm test
```

### Development

```bash
# Start the desktop application in development mode
pnpm --filter desktop tauri dev
```

---

## Agent Guidance

liosvideo includes a universal agent guide and skill designed to work out-of-the-box with ACP agents:
- See [`AGENTS.md`](./AGENTS.md) for the complete developer and agent reference.
- See [`skills/liosvideo/SKILL.md`](./skills/liosvideo/SKILL.md) for the master director skill.

---

## License

This project is licensed under the [MIT License](./LICENSE).
