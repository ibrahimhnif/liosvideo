# Polish, Cloud TTS, Mic Recording, Transitions & Master Agent Skill Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining features from the design specification (Scene Transitions, Live ElevenLabs Cloud TTS, In-App Mic Recording & Chat Voice Cards, Reference Screenshot Diff Overlay) and author a comprehensive Master Agent Skill (`liosvideo`) & updated `AGENTS.md` guide for all ACP agents.

**Architecture:**
- **Runtime Transitions:** `@liosvideo/runtime` adds scene transition primitives (`fade`, `wipe`, `slide`, `dissolve`) evaluated in `evaluateFrame` and blended in WebGPU.
- **Cloud TTS:** `ElevenLabsTtsProvider` in Rust calls ElevenLabs API with character/word alignment timestamps.
- **Mic Recording & Voice Card:** `MediaRecorder` in frontend + `save_voice_recording` in Rust + `VoiceCard.svelte` in Chat stream.
- **Diff Overlay:** Split slider / difference blend mode overlay in `Preview.svelte`.
- **Master Agent Skill:** Authoritative prompt and reference documentation for AI agents (Claude Code, Gemini CLI, etc.) teaching script writing, scene composition, mockup usage, and MCP tools.

---

### Task 1: Scene Transitions in Runtime

**Files:**
- Create: `packages/runtime/src/anim/transition.ts`
- Modify: `packages/runtime/src/composition.ts`
- Modify: `packages/runtime/src/evaluate.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `packages/runtime/test/transition.test.ts`

- [x] **Step 1: Write failing unit test for transitions**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement transitions in runtime**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**

---

### Task 2: Live ElevenLabs Cloud TTS Provider

**Files:**
- Create: `apps/desktop/src-tauri/src/audio/elevenlabs.rs`
- Modify: `apps/desktop/src-tauri/src/audio/mod.rs`
- Modify: `apps/desktop/src-tauri/src/acp/commands.rs`
- Test: `apps/desktop/src-tauri/src/audio/elevenlabs.rs`

- [x] **Step 1: Write failing unit tests for ElevenLabs provider**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement `ElevenLabsTtsProvider`**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**

---

### Task 3: In-App Voice Recording & Voice Line Chat Card

**Files:**
- Create: `apps/desktop/src/lib/audio/recorder.ts`
- Create: `apps/desktop/src/lib/components/VoiceCard.svelte`
- Modify: `apps/desktop/src/lib/components/ChatItem.svelte`
- Modify: `apps/desktop/src-tauri/src/export.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `apps/desktop/src/lib/audio/recorder.test.ts`

- [x] **Step 1: Write unit test for recorder and save voice recording**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement recorder, backend command, and `VoiceCard.svelte`**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**

---

### Task 4: Reference Screenshot Diff Overlay in Preview

**Files:**
- Modify: `apps/desktop/src/lib/components/Preview.svelte`
- Modify: `apps/desktop/src/lib/preview/host.ts`
- Test: `apps/desktop/src/lib/preview/diff_overlay.test.ts`

- [x] **Step 1: Write test for diff overlay mode**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement diff overlay in `Preview.svelte`**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**

---

### Task 5: Master Agent Skill & `AGENTS.md` Guide

**Files:**
- Create: `skills/liosvideo/SKILL.md`
- Create: `.agents/skills/liosvideo/SKILL.md`
- Create: `apps/desktop/src-tauri/templates/skills/liosvideo/SKILL.md`
- Modify: `apps/desktop/src-tauri/src/scaffold.rs`
- Modify: `apps/desktop/src-tauri/templates/AGENTS.md`
- Create: `AGENTS.md` (in repository root)

- [x] **Step 1: Author comprehensive `SKILL.md` for ACP agents**
- [x] **Step 2: Update project scaffold template in `scaffold.rs`**
- [x] **Step 3: Create root `AGENTS.md`**
- [x] **Step 4: Verify agent detection and guidance**
- [x] **Step 5: Commit**

---

### Task 6: Monorepo End-to-End Verification

- [x] **Step 1: Run all test suites across the monorepo**
  - `pnpm --filter liosvideo test` (17 test files, 72 tests passed)
  - `pnpm --filter desktop test` (14 test files, 79 tests passed)
  - `pnpm --filter desktop test:browser` (7 test files, 44 tests passed)
  - `pnpm --filter desktop check` (0 errors, 0 warnings)
  - `cargo test --manifest-path src-tauri/Cargo.toml` (121 passed, 0 failed)
