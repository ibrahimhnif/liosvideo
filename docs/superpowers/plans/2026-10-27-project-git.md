# Project + Git Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and open projects from the app. Every project folder is a git repo the app manages: checkpoints, a history panel with per-commit diffs, and "restore to here", which adds a new commit and never rewrites history. These are the commit primitives the ACP plan will call for auto-commit at the end of each turn.

**Architecture:**
- **Rust (the git and file-system side):**
  - `git.rs` holds pure functions over a project root, built on `git2`.
  - `scaffold.rs` writes a new project from templates embedded with `include_str!`.
  - `recent.rs` keeps the recent-projects list in the app config dir.
  - Thin Tauri commands in `project.rs` wrap these and emit `project://committed` after every commit.
- **Svelte:** a richer project picker (new / open / recent) and a `HistoryPanel` that takes an injected API object, so component tests run without Tauri.

**Tech Stack:**
- existing foundation (Tauri 2, Rust, Svelte 5, Vitest node + browser)
- `git2` (bundled libgit2, so it doesn't depend on the user having git installed)

**Spec:** `docs/superpowers/specs/2026-10-27-liosvideo-design.md` (§7 project folder, §12 git history, §6 history panel + first-run project open/create, §4 anti-goal "losing work")

## Global Constraints

- **Project layout (§7):** `long.ts`, `short.ts`, `scenes/`, `script.md`, `assets/{images,video,fonts}/`, `assets/audio/{vo,music}/`, `.liosvideo/project.json`, `.gitignore`, `AGENTS.md`.
- **Gitignored (§7):** `.liosvideo/cache/` and `out/`, plus `node_modules/` and `.DS_Store`.
- **New projects (§12):** `git init` + `.gitignore` on project creation, then an initial commit.
- **Restore (§12):** creates a new commit that restores that tree. History is never rewritten, so a restore can itself be undone.
- **Manual edits (§12):** changes made outside the app are committed as "Manual edit" before the app makes its own commit. That covers checkpoint, restore and open here, and the agent turn in the ACP plan.
- **No lost work (§4):** every operation that changes the working tree first commits any pending changes.
- **Agent instructions (§7):** `AGENTS.md` is written on creation. `CLAUDE.md` and `GEMINI.md` are symlinks to it (the builder's call, made here).
- **Paths:** every path that comes from the frontend goes through `resolve_in_project` or the name validation in Task 3.

## Review Focus

1. **Restore or checkpoint with uncommitted edits.** The edits are committed as "Manual edit" first and can still be recovered. Test in Task 2.
2. **Opening a folder that sits inside another git repo** (the dev sample at `examples/php2shell-sample` lives inside this repo). No nested repo is created. History shows as disabled, with the outer repo's path as the reason. Test in Task 1.
3. **Opening a folder that is not a project** (a home dir, a downloads folder). Nothing is written to it until the user clicks "Enable history". Test in Task 1 (status) and Task 4 (open does not init).
4. **Binary assets and huge files in a diff.** Images are listed by name and marked binary, with no garbage patch text. Text patches over 200 KB are truncated with a flag. Test in Task 2.
5. **Bad project names on create** (empty, contains `/`, `.`/`..`, or already exists). The user gets a clear error and nothing existing is touched. Test in Task 3.

---

## File Structure

```
apps/desktop/src-tauri/Cargo.toml              # + git2
apps/desktop/src-tauri/src/git.rs              # status, enable, commit, history, diff, restore
apps/desktop/src-tauri/src/scaffold.rs         # create_project_in
apps/desktop/src-tauri/src/recent.rs           # recent projects list
apps/desktop/src-tauri/templates/              # long.ts short.ts scenes/intro.ts script.md AGENTS.md gitignore project.json
apps/desktop/src-tauri/src/project.rs          # commands
apps/desktop/src-tauri/src/lib.rs              # register commands
apps/desktop/src/lib/history/api.ts            # types + Tauri-backed HistoryApi
apps/desktop/src/lib/history/diff.ts           # diffLines()
apps/desktop/src/lib/history/diff.test.ts
apps/desktop/src/lib/components/HistoryPanel.svelte
apps/desktop/src/lib/components/HistoryPanel.browser.test.ts
apps/desktop/src/lib/components/ProjectPicker.svelte
apps/desktop/src/lib/project/templates.browser.test.ts
apps/desktop/src/routes/+page.svelte
```

---

### Task 1: Git repo status, enable, commit and history (Rust)

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml` (`cargo add git2`), `apps/desktop/src-tauri/src/lib.rs` (`mod git;`)
- Create: `apps/desktop/src-tauri/src/git.rs` (unit tests in a `#[cfg(test)] mod tests` using `tempfile`, as `project.rs` does)

**Interfaces:**
- Produces (all `pub`, errors are `ProjectError` from `project.rs`):
  - ```rust
    #[derive(Serialize, PartialEq, Debug)] #[serde(tag = "kind", rename_all = "camelCase")]
    pub enum HistoryStatus { Enabled, Off, Nested { repo: String } }
    #[derive(Serialize, Debug, Clone)] #[serde(rename_all = "camelCase")]
    pub struct CommitInfo { pub id: String, pub short_id: String, pub summary: String, pub message: String, pub time: i64 /* unix secs */ }
    ```
  - `history_status(root: &Path) -> HistoryStatus`:
    - `Enabled` when `root/.git` exists and `Repository::open(root)` works.
    - `Nested` when `Repository::discover(root)` finds a repo whose workdir is a different folder; `repo` is that workdir.
    - `Off` otherwise.
  - `enable_history(root: &Path) -> Result<CommitInfo>`:
    - Refuses with an error unless the status is `Off`.
    - Writes `.liosvideo/project.json` (`{"version": 1}`) if it is missing.
    - Appends to `.gitignore` any of the four required lines that are missing, creating the file if needed.
    - Runs `git init`, stages everything and commits `"Start history"`.
  - `commit_all(root: &Path, message: &str) -> Result<Option<CommitInfo>>`:
    - Stages additions, modifications and deletions, respecting `.gitignore` (`index.add_all(["*"])` + `index.update_all(["*"])`).
    - Returns `None`, without committing, when the tree equals HEAD's tree.
    - Signature: `repo.signature()`, falling back to `liosvideo <liosvideo@localhost>`.
  - `history(root: &Path, limit: usize) -> Result<Vec<CommitInfo>>`: newest first, walking the first-parent chain from HEAD.
  - `const MANUAL_EDIT: &str = "Manual edit";`

- [ ] **Step 1: Write failing tests** (names are the assertions):
  - `status_is_off_for_plain_folder`
  - `status_is_nested_inside_another_repo`: init a repo in the temp dir; `history_status(tmp/sub)` returns `Nested { repo: <tmp canonical> }`.
  - `status_is_off_writes_nothing`: after `history_status`, the folder has no new entries.
  - `enable_history_creates_repo_gitignore_and_first_commit`: status becomes `Enabled`; `history` has one commit with summary `"Start history"`; `.gitignore` contains `out/` and `.liosvideo/cache/`; a pre-existing `.gitignore` line `foo` is kept.
  - `enable_history_refuses_nested`
  - `commit_all_returns_none_when_clean`
  - `commit_all_commits_adds_edits_and_deletes`: add `a.ts`, commit; edit `a.ts`, add `b.ts`, commit; delete `a.ts`, commit. HEAD's tree contains only `b.ts` plus the scaffolding files, and `history` lists 4 commits newest first.
  - `commit_all_skips_ignored_files`: `out/x.mp4` and `.liosvideo/cache/c` are not in the tree.
- [ ] **Step 2: Run** `cd apps/desktop/src-tauri && cargo test git::` → FAIL (does not compile: the functions don't exist).
- [ ] **Step 3: Implement** `git.rs`.
- [ ] **Step 4: Run** `cargo test git::` → PASS, then `cargo test` → all pass.
- [ ] **Step 5: Commit** `feat(desktop): git status, enable, commit and history`.

### Task 2: Commit diffs and restore (Rust)

**Files:**
- Modify: `apps/desktop/src-tauri/src/git.rs`

**Interfaces:**
- Consumes: Task 1 (`commit_all`, `history`, `CommitInfo`, `MANUAL_EDIT`).
- Produces:
  - ```rust
    #[derive(Serialize, Debug)] #[serde(rename_all = "camelCase")]
    pub struct FileDiff { pub path: String, pub status: String /* "added"|"modified"|"deleted"|"renamed" */, pub binary: bool, pub patch: String, pub truncated: bool }
    pub const MAX_PATCH_BYTES: usize = 200 * 1024;
    ```
  - `commit_diff(root: &Path, id: &str) -> Result<Vec<FileDiff>>`:
    - Diffs the first parent's tree against the commit's tree; a root commit is diffed against the empty tree.
    - `patch` is the unified patch text from `git2::Patch`, with 3 context lines.
    - `binary` comes from the delta's binary flag. When it is set, `patch` is `""`.
    - When the text is longer than `MAX_PATCH_BYTES`, it is cut at a char boundary and `truncated` is set to `true`.
  - `restore(root: &Path, id: &str) -> Result<CommitInfo>`:
    1. `commit_all(root, MANUAL_EDIT)`.
    2. Force-checkout the target commit's tree into the workdir, removing tracked files that are absent from the target. Ignored files are left alone.
    3. Write the target tree to the index.
    4. Commit with parent = HEAD, tree = target tree, message `"Restore to {short_id}: {summary}"`.
    - Restoring to the current HEAD's tree returns an error ("Already at this version") and does not commit.

- [ ] **Step 1: Write failing tests:**
  - `diff_lists_added_modified_deleted_files_with_patches`: the patch for a modified `a.ts` contains `-old` and `+new`.
  - `diff_of_root_commit_lists_all_files_as_added`
  - `diff_marks_binary_files_without_patch`: write a PNG-like byte blob containing NULs to `assets/images/x.png`.
  - `diff_truncates_huge_patches`: a 300 KB text file gives `truncated == true` and `patch.len() <= MAX_PATCH_BYTES`.
  - `restore_brings_back_old_tree_as_new_commit`:
    - Setup: commit A (`a.ts = "1"`), commit B (`a.ts = "2"`, adds `b.ts`).
    - `restore(A)` leaves `a.ts == "1"` and `b.ts` gone. `history` has 3 commits, the newest summary starts with `"Restore to "`, and A and B are still listed (never rewritten).
  - `restore_commits_pending_edits_first`: after an uncommitted edit, `restore(A)` produces a `"Manual edit"` commit before the restore commit, and that commit's tree holds the edit.
  - `restore_keeps_ignored_files`: `out/video.mp4` survives the restore.
  - `restore_to_current_tree_is_an_error`
- [ ] **Step 2: Run** `cargo test git::` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cargo test` → PASS.
- [ ] **Step 5: Commit** `feat(desktop): commit diffs and non-destructive restore`.

### Task 3: Project scaffold from templates

**Files:**
- Create: `apps/desktop/src-tauri/templates/{long.ts,short.ts,scenes/intro.ts,script.md,AGENTS.md,gitignore,project.json}`, `apps/desktop/src-tauri/src/scaffold.rs`, `apps/desktop/src/lib/project/templates.browser.test.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (`mod scaffold;`)

**Interfaces:**
- Consumes: `git::enable_history` (Task 1).
- Produces:
  - `pub fn validate_project_name(name: &str) -> Result<()>` rejects:
    - an empty name, or whitespace only
    - names containing `/` or `\`
    - `.` and `..`
    - a leading `.`
  - `pub fn create_project_in(parent: &Path, name: &str) -> Result<PathBuf>`:
    - Validates the name and errors if `parent/name` already exists, writing nothing.
    - Writes the templates: `gitignore` is written as `.gitignore` and `project.json` as `.liosvideo/project.json`.
    - Creates `assets/images`, `assets/video`, `assets/fonts`, `assets/audio/vo` and `assets/audio/music`, each with an empty `.gitkeep`.
    - Symlinks `CLAUDE.md` → `AGENTS.md` and `GEMINI.md` → `AGENTS.md` (relative targets).
    - Calls `enable_history`, which makes the initial commit.
    - Returns the canonical root.
- Template content:
  - `long.ts`: 1920×1080 at 30 fps, background `#0b0d12`, `scenes: [intro]`.
  - `short.ts`: the same at 1080×1920.
  - `scenes/intro.ts`: `scene("intro", { duration: 3 }, …)` with one centered `text({ name: "title", text: "New video" })`, sized from `Math.min(width, height)` so it works in both formats, fading in over 0.6 s. This is the same pattern as the sample's `outro.ts`.
  - `script.md`: `# Script`, then `## long` and `## short` sections with a one-line comment explaining that narration lines go there with stable ids (§15).
  - `project.json`: `{ "version": 1 }`.
  - `gitignore`: `.liosvideo/cache/`, `out/`, `node_modules/`, `.DS_Store`.
- `AGENTS.md` must contain these sections:
  - the project layout (§7)
  - compositions (root `*.ts` default-exporting `composition(...)`)
  - scenes, plus the runtime API that `packages/runtime/src/index.ts` exports today: `scene`, `composition`, `group`, `rect`, `text`, `image`, `set`, `to`, eases, and node names (stable, no `/`, unique per parent)
  - sandbox rules: only relative imports plus `liosvideo`; no network, file system, `Date.now` or `Math.random` (use `ctx.random`); assets are referenced by project-relative path
  - git: the app commits every turn, so don't commit yourself
  - scoped revisions: when given a selection, confine edits to that scene unless asked (§8.4)
  - Keep it accurate to the current API. The ACP plan will extend it.

- [ ] **Step 1: Write failing tests:**
  - Rust tests in `scaffold.rs`:
    - `rejects_bad_names` (each case listed above)
    - `refuses_existing_folder_and_leaves_it_untouched`: a pre-existing folder with a file is unchanged afterwards.
    - `creates_layout_and_initial_commit`: every §7 path exists, the symlinks resolve to `AGENTS.md`, `history_status` is `Enabled`, and there is exactly 1 commit.
  - Browser test `templates.browser.test.ts`: import `long.ts`, `short.ts` and `scenes/intro.ts` from `src-tauri/templates` via `?raw`. Bundle each entry with `bundleComposition(entry, readFile)`, where `readFile` serves those strings. Load the result in a `PreviewHost`. Expect `totalFrames === 90` and `scenes[0].id === "intro"` for both formats.
- [ ] **Step 2: Run** `cargo test scaffold::` and `pnpm --filter desktop test:browser` → FAIL.
- [ ] **Step 3: Implement** the templates and `scaffold.rs`.
- [ ] **Step 4: Run** both → PASS.
- [ ] **Step 5: Commit** `feat(desktop): scaffold new projects with templates and initial commit`.

### Task 4: Tauri commands and recent projects

**Files:**
- Create: `apps/desktop/src-tauri/src/recent.rs`
- Modify: `apps/desktop/src-tauri/src/project.rs`, `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `recent.rs`:
    - `pub const MAX_RECENT: usize = 10;`
    - `pub fn push_recent(list: Vec<String>, root: &str) -> Vec<String>`: puts `root` first, removes duplicates and caps the list at `MAX_RECENT`.
    - `pub fn load_recent(file: &Path) -> Vec<String>`: a missing or corrupt file gives `[]`; entries whose folder no longer exists are dropped.
    - `pub fn save_recent(file: &Path, list: &[String]) -> Result<()>`
    - The file is `app_config_dir()/recent.json`.
  - `ProjectInfo` gains `history: HistoryStatus`.
  - `open_project`:
    - Unchanged, plus: if the status is `Enabled`, run `commit_all(root, MANUAL_EDIT)`, emitting `project://committed` when it commits.
    - Records the folder in recent projects.
    - Never inits a repo.
  - New commands, each resolving against the open project root:
    - `create_project(parent: String, name: String) -> ProjectInfo`: `create_project_in`, then the same path as `open_project`.
    - `enable_history() -> HistoryStatus`
    - `project_history(limit: usize) -> Vec<CommitInfo>`
    - `commit_diff(id: String) -> Vec<FileDiff>`
    - `checkpoint(message: String) -> Option<CommitInfo>`: an empty message becomes `"Checkpoint"`.
    - `restore_commit(id: String) -> CommitInfo`
    - `recent_projects() -> Vec<String>`
  - Each command that commits emits `project://committed` with the payload `CommitInfo`.
  - History commands error with `"History is not enabled for this project"` unless the status is `Enabled`.

- [ ] **Step 1: Write failing tests** (Rust, in `recent.rs` and `project.rs`):
  - `push_recent_moves_existing_to_front_and_caps`
  - `load_recent_drops_missing_folders_and_survives_corrupt_file`
  - `open_inits_nothing_in_plain_folder`: extract the non-Tauri part of `open_project` into `fn prepare_open(root: &Path) -> Result<(PathBuf, HistoryStatus, Option<CommitInfo>)>` and test it. A plain folder gives `Off` and no `.git`; a folder with history and a dirty file gives `Some(commit)` with summary `"Manual edit"`.
- [ ] **Step 2: Run** `cargo test` → FAIL.
- [ ] **Step 3: Implement** the commands and register them in `lib.rs`.
- [ ] **Step 4: Run** `cargo test` → PASS, and `cargo build` → no warnings from the new code.
- [ ] **Step 5: Commit** `feat(desktop): project and history commands, recent projects`.

### Task 5: Project picker and history panel UI

**Files:**
- Create: `apps/desktop/src/lib/history/api.ts`, `apps/desktop/src/lib/history/diff.ts`, `apps/desktop/src/lib/history/diff.test.ts`, `apps/desktop/src/lib/components/HistoryPanel.svelte`, `apps/desktop/src/lib/components/HistoryPanel.browser.test.ts`
- Modify: `apps/desktop/src/lib/components/ProjectPicker.svelte`, `apps/desktop/src/routes/+page.svelte`

**Interfaces:**
- Consumes: the Task 4 commands and the `project://committed` event.
- Produces:
  - `api.ts`:
    - TS mirrors of the Rust types: `HistoryStatus = { kind: "enabled" } | { kind: "off" } | { kind: "nested"; repo: string }`, `CommitInfo { id; shortId; summary; message; time }`, `FileDiff { path; status; binary; patch; truncated }`.
    - `interface HistoryApi { history(limit: number): Promise<CommitInfo[]>; diff(id: string): Promise<FileDiff[]>; checkpoint(message: string): Promise<CommitInfo | null>; restore(id: string): Promise<CommitInfo>; enable(): Promise<HistoryStatus>; onCommitted(cb: () => void): () => void }`
    - `tauriHistoryApi: HistoryApi`, built from `invoke` and `listen`.
  - `diff.ts`: `diffLines(patch: string): { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string }[]`.
    - `@@` lines are `hunk`.
    - `diff --git`, `index`, `---`, `+++`, `new file mode` and similar headers are `meta`.
    - Other lines starting with `+` are `add`, those starting with `-` are `del`, and everything else is `ctx`.
  - `HistoryPanel.svelte` props: `{ status: HistoryStatus; api: HistoryApi; onStatus: (s: HistoryStatus) => void }`.
    - `off`: shows "History is off for this folder" and an **Enable history** button.
    - `nested`: shows "This folder is inside another git repository ({repo}). History is disabled." and no button.
    - `enabled`:
      - A checkpoint input + button.
      - The commit list, newest first, showing summary, short id and relative time; clicking a commit shows its diff.
      - Each file shows path + status; binary files show "binary file"; truncated patches show "diff truncated".
      - Lines are colored by `diffLines` kind.
      - Restore is two-step: **Restore to here**, then **Confirm restore** / **Cancel**. The panel never uses `window.confirm` (it blocks automation).
      - The list reloads on `api.onCommitted`.
  - `ProjectPicker.svelte`:
    - **New project…**: a name input plus parent folder picker; calls `create_project`.
    - **Open folder…**: as before.
    - A **Recent** list from `recent_projects`, where clicking an entry opens it.
    - Errors are shown inline.
  - `+page.svelte`: a "History" toggle in the right header shows `HistoryPanel` as a 320 px column beside the preview, passing `project.history` as `status` and `tauriHistoryApi`.

- [ ] **Step 1: Write failing tests:**
  - `diff.test.ts`: classifies a sample patch whose lines are `diff --git`, `index`, `---`, `+++`, `@@ -1 +1 @@`, `-old`, `+new` and ` same`, in that order, as meta ×4, hunk, del, add, ctx.
  - `HistoryPanel.browser.test.ts`, with a fake `HistoryApi` that records calls:
    - `off` shows the Enable button, and clicking it calls `enable` and then `onStatus`.
    - `nested` shows the repo path and no Enable button.
    - `enabled` lists commits in order.
    - Clicking a commit shows the diff: a `+new` line, and "binary file" for a binary entry.
    - **Restore to here** does not call `restore` until **Confirm restore** is clicked, and **Cancel** never calls it.
    - A checkpoint with text calls `checkpoint("text")`.
- [ ] **Step 2: Run** `pnpm --filter desktop test` and `pnpm --filter desktop test:browser` → FAIL.
- [ ] **Step 3: Implement** the components and the wiring.
- [ ] **Step 4: Run** both → PASS, then `pnpm --filter desktop check` → 0 errors.
- [ ] **Step 5: Manual verification** in `tauri dev`:
  1. Create a project via the app in a temp folder. If clicking isn't possible from the session, set `LIOSVIDEO_PROJECT` to a folder made with a scratch `create_project_in` test binary, or create it through a dev-only env var `LIOSVIDEO_CREATE` (parent/name), and record which.
  2. The preview shows the intro title. Run `git -C <proj> log --oneline` and check there is 1 commit.
  3. Edit `scenes/intro.ts` from the shell, then reopen. Expect a "Manual edit" commit.
  4. Open the dev sample. The history status is `nested` and `examples/php2shell-sample/.git` does not exist.
  5. Record the results in `docs/superpowers/notes/2026-10-27-project-git-verification.md`.
- [ ] **Step 6: Commit** `feat(desktop): project picker and history panel`.
