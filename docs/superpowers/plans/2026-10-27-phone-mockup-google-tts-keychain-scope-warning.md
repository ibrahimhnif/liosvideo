# Plan: Phone Mockup, Google Cloud TTS, Keychain Storage & Out-of-Scope Revision Warning

**Goal:** Implement the remaining 4 features from the design specification:
1. `phone` mockup device frame in `@liosvideo/runtime` for 9:16 compositions.
2. `GoogleCloudTtsProvider` in Rust backend.
3. macOS Keychain storage for API keys (`keyring` / `security-framework`).
4. Out-of-Scope Revision Warning in Chat UI with one-click revert.

---

### Task 1: Phone Mockup in `@liosvideo/runtime`
- **Files:**
  - Create: `packages/runtime/src/mockups/phone.ts`
  - Modify: `packages/runtime/src/index.ts`
  - Test: `packages/runtime/test/mockups/phone.test.ts`
- [x] **Step 1:** Write failing unit test `packages/runtime/test/mockups/phone.test.ts`.
- [x] **Step 2:** Implement `phone(options)` in `packages/runtime/src/mockups/phone.ts` with device bezel, screen container slot, notch/dynamic island, and status bar.
- [x] **Step 3:** Export `phone` from `packages/runtime/src/index.ts`.
- [x] **Step 4:** Run tests and verify.
- [x] **Step 5:** Commit.

---

### Task 2: Google Cloud TTS Provider in Rust
- **Files:**
  - Create: `apps/desktop/src-tauri/src/audio/google_tts.rs`
  - Modify: `apps/desktop/src-tauri/src/audio/mod.rs`
  - Modify: `apps/desktop/src-tauri/src/acp/commands.rs`
  - Modify: `apps/desktop/src-tauri/src/mcp/audio_tools.rs`
  - Test: `apps/desktop/src-tauri/src/audio/google_tts.rs`
- [x] **Step 1:** Write unit test for Google Cloud TTS payload formatting, voice listing, and timepoint alignment parsing.
- [x] **Step 2:** Implement `GoogleCloudTtsProvider`.
- [x] **Step 3:** Register provider in `commands.rs` / `audio_tools.rs`.
- [x] **Step 4:** Run tests and verify.
- [x] **Step 5:** Commit.

---

### Task 3: macOS Keychain Storage for API Keys
- **Files:**
  - Create: `apps/desktop/src-tauri/src/keychain.rs`
  - Modify: `apps/desktop/src-tauri/src/lib.rs`
  - Test: `apps/desktop/src-tauri/src/keychain.rs`
- [x] **Step 1:** Add keychain helper with `get_secret` and `set_secret` using macOS `/usr/bin/security`.
- [x] **Step 2:** Expose Tauri commands `get_api_key`, `set_api_key`, and `delete_api_key`.
- [x] **Step 3:** Connect `ElevenLabsTtsProvider` and `GoogleCloudTtsProvider` to check keychain if env var is absent.
- [x] **Step 4:** Run tests and verify.
- [x] **Step 5:** Commit.

---

### Task 4: Out-of-Scope Revision Warning in Chat UI
- **Files:**
  - Create: `apps/desktop/src/lib/chat/scope_warning.ts`
  - Create: `apps/desktop/src/lib/components/ScopeWarningCard.svelte`
  - Modify: `apps/desktop/src/lib/components/ChatPane.svelte`
  - Modify: `apps/desktop/src-tauri/src/git.rs` (command to revert specific files: `revert_files`)
  - Modify: `apps/desktop/src-tauri/src/project.rs` (tauri command `revert_commit_files`)
  - Modify: `apps/desktop/src-tauri/src/lib.rs`
  - Test: `apps/desktop/src/lib/chat/scope_warning.test.ts`
- [x] **Step 1:** Write unit test for scope detection logic (`detectOutOfScopeChanges`).
- [x] **Step 2:** Implement `detectOutOfScopeChanges` and `revert_files` command.
- [x] **Step 3:** Implement `ScopeWarningCard.svelte` and integrate into `ChatPane.svelte`.
- [x] **Step 4:** Run tests and browser tests.
- [x] **Step 5:** Commit.

---

### Task 5: Monorepo End-to-End Verification
- [x] **Step 1:** Run all test suites across the monorepo (`runtime`, `desktop`, `browser`, `check`, `cargo test`).
  - `pnpm --filter liosvideo test`: 18 files, 73 tests passed.
  - `pnpm --filter desktop test`: 15 files, 82 tests passed.
  - `pnpm --filter desktop test:browser`: 7 files, 44 tests passed.
  - `pnpm --filter desktop check`: 0 errors, 0 warnings.
  - `cargo test`: 126 passed, 0 failed.
- [x] **Step 2:** Update skill and docs to document `phone` mockup and Google Cloud TTS.
- [x] **Step 3:** Commit and report to user.
