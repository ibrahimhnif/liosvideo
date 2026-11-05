# Animation styles — verification

## Checked

- **Filters (preview and export match):** `renderer.browser.test.ts` "filters" (9 tests, WebGPU in Chromium) and `apps/cli/tests/snapshot_test.rs::renders_filters_like_the_preview`. The two `filter.wgsl` copies are byte-identical (parity test and `scripts/check-sync.sh`).
- **Every style, by eye:** CLI snapshots of each demo at 1080×1920 and 1920×1080, plus `examples/style-lab/out/showcase.mp4` (1290 frames, 43 s, 9:16). One frame 2 s into each style was checked on a contact sheet, and a late comic frame was checked separately.
- **Scaffolding:** `cargo test -p desktop` / `-p liosvideo-cli` scaffold tests (validation, blank + style uses the style scene, template + style keeps template scenes, install never overwrites, `project.json` keeps `version`).
  - End to end: `liosvideo project new <tmp> demo --style brick|pixel-art|comic|explainer-3d` creates the project. `liosvideo validate` passes, and `liosvideo snapshot short.ts` renders the style's demo; the comic project's frame was checked by eye.
- **App UI (component tests in Chromium):**
  - ProjectPicker sends `style: "comic"`, or `style: null` when no style is picked.
  - StyleMenu lists the ten in order and picks one.
  - ChatPane installs the style and fills the exact restyle prompt with the selection label; an install error shows a notice and leaves the draft alone.
  - `stylePrompt` is unit-tested for both branches.
- **Suites at the end of Task 7:**

  | Suite | Result |
  | :- | :- |
  | runtime node | 96 |
  | runtime GPU | 25 |
  | desktop node | 99 |
  | desktop browser | 70 |
  | svelte-check | 0 errors |
  | `cargo test -p desktop` | 147 |
  | `cargo test -p liosvideo-cli` | 149 + integration |

## Not checked

- **The running app (`pnpm --dir apps/desktop tauri dev`):** creating a project with "Pixel Art" from the picker and seeing it in the live WebGPU preview, and using the chat Style menu against a real agent. The Tauri commands `list_styles` / `install_style` are covered only by the scaffold unit tests underneath them, not through IPC.
- **The live preview with the 3D styles:** the preview's software three renderer (`three_soft.ts`) mirrors the CLI host, and both received the same `traverseVisible` fix, but no 3D style was viewed in the app.
- **`long.ts` (16:9 reel):** not rendered to MP4. Each scene was snapshotted at 1920×1080 instead.
