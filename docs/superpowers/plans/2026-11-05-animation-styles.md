# Animation Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ten pickable animation styles: engine filters in both renderers, a style kit project, an agent skill, a showcase reel, and a style picker in the desktop app, chat and CLI.

**Architecture:** Six filter props on every node become an isolated layer with a fixed chain of fullscreen passes from one shared `filter.wgsl`, run identically by the desktop WebGPU renderer and the CLI wgpu renderer. `examples/style-lab/` is a renderable liosvideo project holding the ten style modules, demo scenes, docs and showcase; both scaffolders embed its files with `include_str!`. The desktop picker, chat Style menu and `liosvideo project new --style` install those files into a project.

**Tech Stack:** TypeScript runtime + WGSL (WebGPU), Rust wgpu CLI with deno_core, Tauri 2 + Svelte 5, Vitest (node + browser), cargo test, rolldown (IIFE bundle).

**Spec:** `docs/superpowers/specs/2026-11-05-animation-styles-design.md`

## Global Constraints

- Filter props, units and order exactly as spec §3: `pixelate → posterize → halftone → outline → chalk → glow`, after `blur`; px values are composition px × device scale.
- `packages/runtime/src/gpu/shaders/filter.wgsl` and `apps/cli/src/gpu/shaders/filter.wgsl` are byte-identical (parity test + `scripts/check-sync.sh` pair).
- Style ids exactly: `pixel-art`, `chalkboard`, `glow-sketch`, `ps2-lowpoly`, `comic`, `flat-vector`, `minimal-mono`, `cgi-motion`, `brick`, `explainer-3d`. UI titles exactly as spec §2. No trademarked names in ids, file names or titles.
- Style files import only `liosvideo` (and `three` for 3D styles); deterministic: no `Math.random`, `Date.now`, promises — use the scene `random()`.
- Installing a style never overwrites an existing file.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test commands: runtime `pnpm --dir packages/runtime test` and `pnpm --dir packages/runtime test:gpu`; desktop `pnpm --dir apps/desktop test`, `test:browser`, `check`; Rust `cargo test -p desktop` and `cargo test -p liosvideo-cli` from the repo root (use `rtk proxy` for raw output).

## Review Focus

1. **Filters combined with clip, opacity < 1, blur, and nested filtered groups.** Each layer filters its own content once; a clipped, half-transparent, pixelated group shows clipped pixel blocks at half opacity, no double filtering of the parent.
2. **Preview size ≠ export size.** A 6 px pixelate cell is 6 composition px whether the preview canvas is 540 wide or the export 1080 wide.
3. **Animated filters crossing zero** (`pixelate` tweened 40 → 0 as a "resolve"). Non-integer cells don't shimmer the whole frame; at exactly 0 the node is no longer a layer and renders as before.
4. **Transparent edges.** Posterize, halftone and pixelate on premultiplied content produce no dark fringes or colour on fully transparent pixels.
5. **Installing a style into a project that already has `styles/<id>.ts` or a modified doc.** Files are left as they are; the call still succeeds and the prompt is still filled.

---

### Task 1: Filter props and layer plumbing (runtime)

**Files:**
- Modify: `packages/runtime/src/graph/node.ts` (BaseProps + BASE_DEFAULTS), `packages/runtime/src/renderlist.ts` (LayerItem), `packages/runtime/src/evaluate.ts` (`emit`)
- Test: `packages/runtime/test/evaluate.test.ts`, `packages/runtime/test/node.test.ts`

**Interfaces:**
- Produces: `BaseProps` gains `pixelate, posterize, halftone, outline, chalk, glow, glowIntensity: number` and `outlineColor: string` (defaults 0,0,0,0,0,0,1,"#111111"). `LayerItem` gains `filters?: Filters` where `export type Filters = { pixelate: number; posterize: number; halftone: number; outline: number; outlineColor: string; chalk: number; glow: number; glowIntensity: number }`, present only when at least one of the six effect props is > 0. `export function activeFilters(p: BaseProps): Filters | undefined` in `evaluate.ts`.

- [ ] **Step 1: Write the failing tests** in `evaluate.test.ts`:
  - `"wraps a filtered group into a layer with its filters"`: `group({ name: "g", pixelate: 6, outline: 2 })` with a child rect → layer `{ kind: "layer", path: "s/g", filters: { pixelate: 6, posterize: 0, halftone: 0, outline: 2, outlineColor: "#111111", chalk: 0, glow: 0, glowIntensity: 1 } }`.
  - `"a filter tweened to zero stops isolating the node"`: `pixelate: 40` then `.to({ pixelate: 0 }, { at: 0, duration: 1 })`; at t = 0.5 the item is a layer with `filters.pixelate` 20; at t = 1 no layer is emitted (rect is a direct item).
  - `"nested filtered groups make nested layers"`: outer `posterize: 4` contains inner `glow: 8` → layer containing a layer, each with only its own filter non-zero.
  - Update the BASE_DEFAULTS expectation in `node.test.ts` with the new defaults.
- [ ] **Step 2: Run** `pnpm --dir packages/runtime test -- evaluate node` — Expected: FAIL (filters undefined / unknown props).
- [ ] **Step 3: Implement** the props, `Filters`, `activeFilters`, and `isolated = … || activeFilters(p) !== undefined` in `emit`, adding `filters` to the layer item.
- [ ] **Step 4: Run** the same command — Expected: PASS; then full `pnpm --dir packages/runtime test` green.
- [ ] **Step 5: Commit** `feat(runtime): filter props on nodes`.

### Task 2: `filter.wgsl` and the desktop WebGPU passes

**Files:**
- Create: `packages/runtime/src/gpu/shaders/filter.wgsl`
- Modify: `packages/runtime/src/gpu/renderer.ts` (`drawLayer`, pipelines)
- Test: `packages/runtime/test/gpu/renderer.browser.test.ts`

**Interfaces:**
- Consumes: `LayerItem.filters` (Task 1).
- Produces: `filter.wgsl`, prepended with `common.wgsl` like `blur.wgsl`, entry `fs`, bindings `@group(0) @binding(0) var<uniform> u: FilterU; @binding(1) var src: texture_2d<f32>; @binding(2) var extra: texture_2d<f32>;` with `struct FilterU { mode: f32, amount: f32, scale: f32, intensity: f32, color: vec4f }`. Modes: 1 pixelate, 2 posterize, 3 halftone, 4 outline, 5 chalk, 6 glow-combine (`src` = layer, `extra` = its blurred copy; other modes bind `src` twice). `amount` is the prop value already multiplied by device scale for px props; `color` is premultiplied `outlineColor`.
- Glow = two existing blur passes (sigma = glow × sx / 2) into a temp texture, then mode 6 adds `extra × intensity` to `src`.
- All modes unpremultiply before colour maths and re-premultiply; fully transparent input stays (0,0,0,0) except outline/glow, which may add colour outside the shape.

- [ ] **Step 1: Write the failing browser tests** (one per filter, 64×64 compositions, read back pixels with the existing helper in this file):
  - `pixelate`: a horizontal gradient group with `pixelate: 8` → every 8×8 cell is one colour (max channel diff within a cell ≤ 1/255).
  - `posterize`: gradient with `posterize: 4` → at most 4 distinct red values across a row.
  - `halftone`: mid-grey rect with `halftone: 8` → each 8×8 cell has darker centre pixels than corner pixels.
  - `outline`: 20×20 white rect at the centre of a transparent group with `outline: 2` → pixels 1 px outside the rect are `#111111`-ish opaque; centre stays white.
  - `chalk`: white rect with `chalk: 0.8` → mean alpha in the rect between 0.3 and 0.9, and two renders of the same frame are identical.
  - `glow`: 10×10 white rect with `glow: 8` → pixel 6 px outside the rect has alpha > 0.05 (no glow → 0).
  - `"filters scale with the canvas"`: render the pixelate case at device scale 0.5 → cells are 4 device px.
  - `"premultiplied edges"`: a half-transparent red rect on transparent with `posterize: 4` → transparent pixels remain (0,0,0,0), rect pixels keep red hue (g, b ≈ 0).
- [ ] **Step 2: Run** `pnpm --dir packages/runtime test:gpu` — Expected: the new tests FAIL (no filtering).
- [ ] **Step 3: Implement** `filter.wgsl` and the pass chain in `drawLayer` after the blur block, ping-ponging between `content` and an acquired temp, in the fixed order.
- [ ] **Step 4: Run** `pnpm --dir packages/runtime test:gpu` — Expected: PASS, existing GPU tests still pass.
- [ ] **Step 5: Commit** `feat(runtime): pixelate, posterize, halftone, outline, chalk and glow filters`.

### Task 3: CLI renderer parity and runtime bundle

**Files:**
- Create: `apps/cli/src/gpu/shaders/filter.wgsl` (copy), `scripts/build-cli-runtime.mjs`
- Modify: `apps/cli/src/gpu/renderer/mod.rs` (filter pipeline, layer pass chain, parity test list), `apps/cli/src/runtime/liosvideo.iife.js` (regenerated), `apps/cli/src/runtime/loader.rs` (export list if new names), `scripts/check-sync.sh` (add the filter.wgsl pair), root `package.json` (`"build:cli-runtime": "node scripts/build-cli-runtime.mjs"`)
- Test: `apps/cli/tests/snapshot_test.rs` (new test fn), `apps/cli/src/gpu/renderer/mod.rs` (`shaders_match_runtime_sources`)

**Interfaces:**
- Consumes: `filter.wgsl` (Task 2), `filters` in the layer JSON (Task 1).
- Produces: `scripts/build-cli-runtime.mjs` bundles `packages/runtime/src/index.ts` with rolldown (`format: "iife"`, `name: "__liosvideo"`, `three` external exactly as the current bundle treats it) into `apps/cli/src/runtime/liosvideo.iife.js`.

- [ ] **Step 1: Write the failing tests:** add `("filter.wgsl", FILTER_WGSL)` to `shaders_match_runtime_sources`; in `snapshot_test.rs` add `renders_filters_like_the_preview` rendering a 64×64 composition with a gradient group `pixelate: 8` and a white rect `outline: 2`, asserting the same pixel properties as Task 2's pixelate and outline tests.
- [ ] **Step 2: Run** `cargo test -p liosvideo-cli shaders_match renders_filters` — Expected: FAIL (no `FILTER_WGSL`; filters ignored — the bundle lacks the props).
- [ ] **Step 3: Implement:** copy the shader, add the pipeline and the same pass chain after the blur block in the layer function (read params with `f32_of(filters, …)`), write and run the bundle script, add the sync pair.
- [ ] **Step 4: Run** `cargo test -p liosvideo-cli` and `bash scripts/check-sync.sh` — Expected: PASS; the sync script reports no drift for the four wgsl pairs plus filter.wgsl.
- [ ] **Step 5: Commit** `feat(cli): filters in the headless renderer; reproducible runtime bundle`.

### Task 4: Style kit — the six 2D styles

**Files:**
- Create: `examples/style-lab/.liosvideo/project.json` (`{ "version": 1 }`), `examples/style-lab/tsconfig.json` (copy fx-lab's), `examples/style-lab/styles/{pixel-art,chalkboard,glow-sketch,comic,flat-vector,minimal-mono}.ts`, `examples/style-lab/scenes/<same ids>.ts`, `examples/style-lab/styles/catalog.ts`, `examples/style-lab/docs/<same ids>.md`
- Test: `packages/runtime/test/style-lab.test.ts`

**Interfaces:**
- Consumes: filter props (Task 1).
- Produces, per style module: `export const theme: { colors: Record<string, string>; fonts: Record<string, string>; ease: Record<string, Ease> }`, `export const look: Partial<BaseProps>` (may be `{}`), and helpers taking `(init) => Node` plus `NodeInit` props; each demo scene `export default scene("<id>", { duration: 4 }, …)`.
- `catalog.ts`: `export type StyleInfo = { id: string; title: string; inspiration?: string; description: string; ratio: "16:9" | "9:16" | "both"; three: boolean }` and `export const STYLES: StyleInfo[]` with all ten ids in spec order (the four 3D entries are filled in Task 5).
- Docs: each `docs/<id>.md` has sections Look, Palette, Motion, Helpers (signatures + one example), Do / Don't.

- [ ] **Step 1: Write the failing test** `style-lab.test.ts` (resolve `liosvideo` to the runtime source with a vitest alias if needed):
  - `"every catalogued style has a module, a demo scene and a doc"` — for each `STYLES` entry, the three files exist.
  - `"demo scenes build deterministically at 16:9 and 9:16"` — for each implemented style, `buildManifest` of a composition with its scene at 1920×1080 and 1080×1920 succeeds, has ≥ 3 nodes, and two builds are equal (excluding `site`).
  - `"style files import only liosvideo and three"` — regex over each `styles/*.ts` and `scenes/*.ts` import specifier: allowed `liosvideo`, `three`, or relative `./` / `../`.
  - `"no nondeterminism"` — files contain no `Math.random`, `Date.now`, `await`, `new Promise`.
  - `"filter looks are used"` — `pixel-art` look has `pixelate > 0` and `posterize > 0`; `comic` has `outline > 0` and `halftone > 0`; `chalkboard` uses `chalk > 0`; `glow-sketch` uses `glow > 0`.
- [ ] **Step 2: Run** `pnpm --dir packages/runtime test -- style-lab` — Expected: FAIL (files missing).
- [ ] **Step 3: Implement** the six modules, scenes, catalog (2D entries) and docs. Snapshot one frame per scene with `liosvideo snapshot` (CLI) and look at each PNG; fix anything that doesn't read as the style.
- [ ] **Step 4: Run** the test — Expected: PASS for the six; the 3D four are listed as pending via `it.todo` until Task 5.
- [ ] **Step 5: Commit** `feat(style-lab): pixel art, chalkboard, glow sketch, comic, flat vector and minimal mono styles`.

### Task 5: Style kit — the four 3D styles, showcase and skill

**Files:**
- Create: `examples/style-lab/styles/{ps2-lowpoly,cgi-motion,brick,explainer-3d}.ts`, matching `scenes/` and `docs/`, `examples/style-lab/showcase.ts`, `examples/style-lab/long.ts`, `examples/style-lab/README.md`, `.agents/skills/style-kit/SKILL.md`
- Modify: `examples/style-lab/styles/catalog.ts`, `packages/runtime/test/style-lab.test.ts`

**Interfaces:**
- Consumes: `three()` node, filter props, Task 4 shapes.
- Produces: `showcase.ts` default-exports a 1080×1920 30 fps composition: a 3 s title card listing the ten titles, then each demo scene (~4 s) in catalog order with `transition("fade", { duration: 0.3 })`; `long.ts` the same at 1920×1080. The skill lists the ten styles (id, title, when to use), how to install one (copy files, or the app's Style menu), and links each doc.

- [ ] **Step 1: Write the failing tests:** turn the `it.todo` entries into the Task 4 checks for the four 3D styles; add `"3D styles use three()"` (each 3D demo scene's manifest contains a node of kind `three`) and `"the showcase lists every style once"` (manifest scene ids = `["title", ...STYLES.map(s => s.id)]`).
- [ ] **Step 2: Run** `pnpm --dir packages/runtime test -- style-lab` — Expected: FAIL.
- [ ] **Step 3: Implement**; render `liosvideo render examples/style-lab/showcase.ts` to `examples/style-lab/out/showcase.mp4` and snapshot frame 2 s into each style; look at every frame and fix what doesn't read as the style.
- [ ] **Step 4: Run** the test — Expected: PASS; full runtime suite green.
- [ ] **Step 5: Commit** `feat(style-lab): PS2, CGI motion, brick and 3D explainer styles, showcase reel and style-kit skill`.

### Task 6: Scaffolding with a style (desktop + CLI)

**Files:**
- Modify: `apps/desktop/src-tauri/src/scaffold.rs`, `apps/cli/src/project/scaffold.rs` (same change), `apps/desktop/src-tauri/templates/AGENTS.md`, `apps/desktop/src-tauri/templates/skills/liosvideo/SKILL.md` and their CLI copies, `apps/desktop/src-tauri/src/project.rs` (`create_project` gains `style: Option<String>`), `apps/cli/src/cli/mod.rs` + `commands.rs` (`project new --style`, new top-level `styles` subcommand)
- Test: unit tests in both `scaffold.rs` files; CLI arg-parsing test where `New` is already tested

**Interfaces:**
- Produces (both scaffolders):
  - `pub const STYLES: [(&str, &str); 10]` — (id, title) in spec order.
  - `pub fn validate_style_id(style: Option<&str>) -> Result<Option<&'static str>>` — `None`/empty → `Ok(None)`; unknown → `Err("Unknown style: <id>")`.
  - `pub fn style_files(id: &str) -> Vec<(&'static str, &'static str)>` — `styles/<id>.ts`, `.agents/skills/liosvideo/styles/<id>.md`, and the scene source under key `scenes/<id>.ts`, embedded with `include_str!` from `examples/style-lab`.
  - `pub fn install_style(root: &Path, id: &str) -> Result<Vec<String>>` — writes `styles/<id>.ts` and the doc where missing (never overwrites), sets `"style"` in `.liosvideo/project.json` preserving other keys, returns the paths it wrote.
  - `create_project_with(parent, name, template, style, init)` — after the template files, `install_style`; with template `blank`, the style scene replaces `scenes/intro.ts`.
- Templates: AGENTS.md and the director skill gain a "Visual styles" section: if `.liosvideo/project.json` has `style`, follow `.agents/skills/liosvideo/styles/<style>.md` and use `styles/<style>.ts`.

- [ ] **Step 1: Write the failing tests** (desktop `scaffold.rs`, mirrored in CLI):
  - `validates_styles` — all ten ids ok, `None`/`""` → `None`, `"lego"` → error.
  - `blank_with_style_uses_the_style_scene` — `create_project_with(…, Some("blank"), Some("comic"), …)` → `styles/comic.ts` exists, `scenes/intro.ts` equals the embedded comic scene, project.json has `"style": "comic"` and `"version": 1`, doc exists.
  - `template_with_style_keeps_template_scenes` — `minimal-dev` + `pixel-art` → `scenes/main.ts` from minimal-dev, `styles/pixel-art.ts` present.
  - `install_style_never_overwrites` — edit `styles/comic.ts`, install again → content unchanged, returned list excludes it, project.json `style` updated.
  - CLI: `liosvideo project new /tmp x --style comic` parses to `New { style: Some("comic"), .. }`; `liosvideo styles` parses.
- [ ] **Step 2: Run** `cargo test -p desktop scaffold` and `cargo test -p liosvideo-cli scaffold` — Expected: FAIL.
- [ ] **Step 3: Implement**; `liosvideo styles` prints `id  title` per line.
- [ ] **Step 4: Run** both full Rust suites and `bash scripts/check-sync.sh` — Expected: PASS; scaffold.rs pair reports no new drift beyond the existing Tauri-only differences.
- [ ] **Step 5: Commit** `feat: create projects with an animation style (desktop + CLI)`.

### Task 7: Style picker in the app and the chat Style menu

**Files:**
- Modify: `apps/desktop/src-tauri/src/project.rs` (commands `list_styles`, `install_style`), `apps/desktop/src-tauri/src/lib.rs` (register), `apps/desktop/src/lib/components/ProjectPicker.svelte`, `apps/desktop/src/lib/components/ChatPane.svelte`
- Create: `apps/desktop/src/lib/styles/api.ts`, `apps/desktop/src/lib/components/StyleMenu.svelte`
- Test: `ProjectPicker.browser.test.ts`, `ChatPane.browser.test.ts`, new `StyleMenu.browser.test.ts`

**Interfaces:**
- Consumes: `STYLES`, `install_style` (Task 6).
- Produces: Tauri `list_styles() -> Vec<{ id, title }>`; `install_style(id) -> Vec<String>` on the open project (emits nothing; the watcher picks up files). TS `type StyleInfo = { id: string; title: string }`; `listStyles(): Promise<StyleInfo[]>`; `installStyle(id): Promise<string[]>`; `stylePrompt(title: string, id: string, selectionLabel?: string): string` returning exactly `Restyle ${selectionLabel ?? "this video"} in the ${title} style — follow .agents/skills/liosvideo/styles/${id}.md and use styles/${id}.ts.`
- ProjectPicker: a "Visual style" radiogroup (aria-label `Visual styles`) with "None" (default) + ten cards; `create_project` is invoked with `style: selected === "none" ? null : selected`.
- StyleMenu: a button labelled `Style` opening a list of the ten (role `menu`, items role `menuitem` named by title); choosing one calls `onPick(style)`.
- ChatPane: StyleMenu beside the composer; on pick → `installStyle(id)`, then composer text = `stylePrompt(...)` with the current selection label; errors show as a chat notice.

- [ ] **Step 1: Write the failing tests:**
  - ProjectPicker: choosing "Comic Art" then Create → `create_project` invoked with `{ …, style: "comic" }`; untouched → `style: null`.
  - StyleMenu: opening shows ten menuitems in spec order; clicking "Pixel Art" calls `onPick` with `{ id: "pixel-art", title: "Pixel Art" }`.
  - ChatPane: with a selection, picking "Comic Art" calls `installStyle("comic")` and the textarea value equals `stylePrompt("Comic Art", "comic", <selection label>)`; an install error renders an error notice and leaves the textarea unchanged.
  - `stylePrompt` unit test in node (`src/lib/styles/api.test.ts`) for both branches.
- [ ] **Step 2: Run** `pnpm --dir apps/desktop test` and `test:browser` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** desktop node, browser, `check`, and `cargo test -p desktop` — Expected: all PASS, 0 svelte-check errors.
- [ ] **Step 5: Manual check:** `pnpm --dir apps/desktop tauri dev`, create a project with "Pixel Art", see the pixelated starter in the preview; use the chat Style menu in another project and see the prompt filled. Record what was and wasn't checked in `docs/superpowers/notes/2026-11-05-animation-styles-verification.md`.
- [ ] **Step 6: Commit** `feat(desktop): style picker for new projects and the chat Style menu`.
