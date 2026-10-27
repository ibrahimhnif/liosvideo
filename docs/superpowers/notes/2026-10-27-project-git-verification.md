# Project + Git: manual verification (2026-10-27)

1. **Create.** The UI can't be clicked from the session, so the project was created by calling `create_project_in(<scratch>/verify, "demo")` from a temporary `#[ignore]` test that was not committed. That is the same function the `create_project` command calls.
   - Result: the full §7 layout, with `CLAUDE.md` and `GEMINI.md` symlinked to `AGENTS.md`.
   - `git log` shows one commit, `Start history`.
2. **Manual edit on open.** Changed the title in `scenes/intro.ts` from the shell, then ran `LIOSVIDEO_PROJECT=<demo> pnpm tauri dev`.
   - `git log`: `Manual edit`, then `Start history`.
   - The dev log showed `timeline long.ts intro | title` and `loaded long.ts 1920x1080 frames=90`.
   - Snapshot frame 89 shows the edited title "Edited outside", centered.
3. **Nested repo.** Opened `examples/php2shell-sample` (inside this repo) with `LIOSVIDEO_PROJECT`.
   - The preview loaded (`frames=330`).
   - No `.git` was created in the sample, and the outer repo's `git status` showed no new files.
4. **Not exercised by hand:** clicking the history panel, restore and checkpoint. These are covered by the `HistoryPanel` component tests (with a fake API) and the Rust `git::` tests (against real repos).
