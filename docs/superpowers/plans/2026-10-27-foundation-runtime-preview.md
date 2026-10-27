# Foundation: Runtime + Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri desktop app that opens a project folder, bundles its `long.ts`/`short.ts` compositions, renders their scene graphs deterministically with WebGPU inside a sandboxed worker, and shows a scrubbable live preview that hot-reloads on file changes.

**Architecture:** A pnpm monorepo. `packages/runtime` is the `liosvideo` TypeScript library. Its pure core (scene graph, animation tracks, composition layout, frame evaluation → render list) has no GPU dependency and is unit-tested in Node. A separate WebGPU renderer turns render lists into pixels. `apps/desktop` is Tauri 2 + Svelte 5. Rust owns file access (path-guarded) and file watching. The frontend bundles project TS with esbuild-wasm (`liosvideo` imports are mapped to a global the worker provides), then runs it in a Web Worker with network globals stripped, rendering into a transferred OffscreenCanvas.

**Tech Stack:** Tauri 2, Rust (`notify`, `serde`), Svelte 5 + Vite, TypeScript, WebGPU/WGSL, esbuild-wasm, Vitest (node + browser mode via Playwright Chromium for GPU tests), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-27-liosvideo-design.md` (this plan implements §13.1 spike, §9.1 core, §9.3, and the preview parts of §6. Mockups §9.2, timeline §9.4, git §12, ACP §8, audio §10 and export §11 are later plans.)

## Global Constraints

- macOS 26+ on Apple Silicon. Tauri 2 using the system WKWebView (spec §15).
- Rendering is a pure function of (composition, frame): no `Date.now`, no unseeded randomness, no frame-to-frame state (spec §9.1).
- Scene code runs in a Web Worker with no Tauri API, file system or network access (spec §9.3).
- Any root-level `*.ts` file default-exporting a composition is renderable (spec §7).
- Revision visible in ≤2 s after a file is written (spec §9.3).
- Rust file access is scoped to the open project folder (spec §8.2).
- Coordinates are pixels, origin top-left of the composition. Time in scene code is seconds relative to scene start. Frames are integers, `time = frame / fps`.

## Review Focus

1. **Scene code throws** (during build or at a specific frame) → the error overlay shows message + file:line, the last good frame stays visible, the app keeps running. Test in Task 9.
2. **Scene code never returns** (infinite loop) → the host terminates the worker after 5 s, shows "Scene code timed out", and recovers on the next reload. Test in Task 9.
3. **Rapid successive saves** (the agent writes several files in a burst, or a half-written file) → builds are debounced, and only the newest build result is applied, never an older one finishing late. Test in Task 8.
4. **Paths escaping the project** (`../`, absolute paths, symlinks out) for file reads or assets → rejected with an error, no read. Test in Task 7.
5. **Out-of-range frames and empty compositions** (seek < 0 or ≥ total, zero scenes) → frames clamp, and an empty composition renders its background without throwing. Test in Task 4.

---

## File Structure

```
package.json, pnpm-workspace.yaml, .gitignore
packages/runtime/                 # npm name "liosvideo"
  src/index.ts                    # public API re-exports
  src/anim/easing.ts              # easing functions by name
  src/anim/track.ts               # keyframe tracks + interpolation
  src/math/affine.ts              # 2D affine matrices
  src/math/color.ts               # hex parse/format/lerp
  src/math/random.ts              # seeded RNG
  src/graph/node.ts               # Node base, props, to()/set(), children, paths
  src/graph/kinds.ts              # group/rect/text/image factories
  src/composition.ts              # scene(), composition(), layoutComposition()
  src/evaluate.ts                 # evaluateFrame() → RenderList
  src/renderlist.ts               # RenderList types
  src/gpu/renderer.ts             # createRenderer()
  src/gpu/shaders/*.wgsl          # rect SDF, textured quad, blur, composite
  src/gpu/text.ts                 # TextRasterizer (OffscreenCanvas 2D → texture)
  test/*.test.ts                  # node unit tests
  test/gpu/*.browser.test.ts      # Vitest browser-mode GPU tests
apps/desktop/
  src-tauri/src/lib.rs            # command registration
  src-tauri/src/project.rs        # path guard, list/read commands
  src-tauri/src/watch.rs          # notify watcher → events
  src/lib/probe/                  # capability probe (Task 1)
  src/lib/bundle/bundler.ts       # esbuild-wasm project bundler
  src/lib/preview/render.worker.ts
  src/lib/preview/host.ts         # PreviewHost (worker lifecycle, latest-wins)
  src/lib/preview/clock.ts        # PlaybackClock, formatTimecode
  src/lib/components/*.svelte     # Preview, Transport, ErrorOverlay, CompositionSwitcher
  src/routes/+page.svelte (or App.svelte)
examples/php2shell-sample/        # hand-written sample project: long.ts, short.ts, scenes/, assets/
docs/superpowers/notes/           # spike results
```

---

### Task 1: Workspace scaffold + capability probe (spec §13.1)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `apps/desktop/**` (from `pnpm create tauri-app` Svelte + TS template), `packages/runtime/package.json` + `tsconfig.json` + `vitest.config.ts`
- Create: `apps/desktop/src/lib/probe/capabilities.ts`, `apps/desktop/src/lib/probe/probe.worker.ts`, `apps/desktop/src/lib/probe/Probe.svelte`
- Create: `docs/superpowers/notes/2026-10-27-capability-probe.md`
- Test: `apps/desktop/src/lib/probe/capabilities.test.ts`

**Interfaces:**
- Produces: `type Capabilities = { webgpu: boolean; webgpuInWorker: boolean; offscreen2dInWorker: boolean; systemFontInWorker: boolean; videoEncoderH264: boolean; videoDecoderH264: boolean; audioEncoderAAC: boolean }`, `probeCapabilities(): Promise<Capabilities>`, `blockingFailures(c: Capabilities): string[]` (returns names of failed checks that block this plan: `webgpu`, `webgpuInWorker`, `offscreen2dInWorker`).

- [ ] **Step 1: Scaffold.** pnpm workspace with `apps/*`, `packages/*`. Tauri 2 Svelte-TS app in `apps/desktop`. `packages/runtime` named `liosvideo`, ESM, `"type": "module"`, Vitest. Set the Tauri CSP to `default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost blob: data:`. Run `pnpm install && pnpm --filter desktop tauri dev`. Expected: the template window opens.
- [ ] **Step 2: Write failing test** `blockingFailures`: all-true → `[]`. `{...allTrue, webgpuInWorker:false, audioEncoderAAC:false}` → `["webgpuInWorker"]` (AAC is not blocking here).
- [ ] **Step 3: Run** `pnpm --filter desktop vitest run capabilities` → FAIL.
- [ ] **Step 4: Implement** `capabilities.ts` + `probe.worker.ts`. The worker checks `navigator.gpu.requestAdapter()`, `new OffscreenCanvas(1,1).getContext('2d')`, and measures `"Ag"` in `13px "SF Pro Text"` vs `13px monospace` (different widths → system font available). Encoders via `VideoEncoder.isConfigSupported({codec:'avc1.640028', width:1920, height:1080, bitrate:8e6, framerate:30})`, `VideoDecoder.isConfigSupported({codec:'avc1.640028'})`, `AudioEncoder.isConfigSupported({codec:'mp4a.40.2', sampleRate:48000, numberOfChannels:2, bitrate:192000})`. `Probe.svelte` shows the table, available at a dev-only toggle in the window.
- [ ] **Step 5: Run test** → PASS.
- [ ] **Step 6: Run in the real app** (`pnpm --filter desktop tauri dev`), record every value + macOS version in `docs/superpowers/notes/2026-10-27-capability-probe.md`. **Gate:** if `webgpu` is false, stop and report to the user (spec §15). If only `webgpuInWorker` or `offscreen2dInWorker` is false, note it. Task 9 then uses the main-thread fallback (render in a sandboxed iframe, `sandbox="allow-scripts"`, same protocol).
- [ ] **Step 7: Commit** `feat: scaffold workspace and capability probe`.

### Task 2: Easing, color, and keyframe tracks

**Files:**
- Create: `packages/runtime/src/anim/easing.ts`, `src/anim/track.ts`, `src/math/color.ts`
- Test: `packages/runtime/test/track.test.ts`, `test/color.test.ts`

**Interfaces:**
- Produces:
  - `type EaseName = 'linear'|'inQuad'|'outQuad'|'inOutQuad'|'inCubic'|'outCubic'|'inOutCubic'|'outBack'|'inOutExpo'`. `ease(name: EaseName, t: number): number` (t clamped to [0,1]). `type Ease = EaseName | ((t:number)=>number)`
  - `parseColor(hex: string): [r,g,b,a]` (0–1 floats, accepts `#rgb`, `#rrggbb`, `#rrggbbaa`), `lerpColor(a: string, b: string, t: number): string` (returns `#rrggbbaa`)
  - `type Segment<T> = { start: number; end: number; from: T | undefined; to: T; ease: Ease }` (seconds). `class Track<T extends number|string> { constructor(initial: T); add(seg: Segment<T>): void; valueAt(t: number): T }`

- [ ] **Step 1: Write failing tests:** `ease('linear',0.5)===0.5`. `ease('inOutCubic',0)===0 && ===1 at 1`. `ease(any, 2)===1`. `parseColor('#f00')` → `[1,0,0,1]`. `lerpColor('#000000','#ffffff',0.5)==='#808080ff'`. Track semantics:
  ```ts
  const tr = new Track<number>(0);
  tr.add({ start: 1, end: 2, from: undefined, to: 100, ease: 'linear' });
  tr.add({ start: 3, end: 4, from: undefined, to: 50, ease: 'linear' });
  expect(tr.valueAt(0.5)).toBe(0);    // before first segment → initial
  expect(tr.valueAt(1.5)).toBe(50);
  expect(tr.valueAt(2.5)).toBe(100);  // holds end value
  expect(tr.valueAt(3.5)).toBe(75);   // from=undefined → value at segment start (100)
  expect(tr.valueAt(10)).toBe(50);
  // zero-duration segment = instant set
  const s = new Track<number>(0); s.add({start:1,end:1,from:undefined,to:9,ease:'linear'});
  expect(s.valueAt(0.999)).toBe(0); expect(s.valueAt(1)).toBe(9);
  ```
  String tracks interpolate colors with `lerpColor` when both ends start with `#`. Other strings switch at `start`.
- [ ] **Step 2: Run** `pnpm --filter liosvideo vitest run` → FAIL.
- [ ] **Step 3: Implement.** Segments kept sorted by `start`. `valueAt` resolves `from: undefined` lazily as `valueAt(seg.start)` from the previous segments (pure, no caching across calls that depends on call order).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(runtime): easing, color and keyframe tracks`.

### Task 3: Scene graph nodes

**Files:**
- Create: `packages/runtime/src/graph/node.ts`, `src/graph/kinds.ts`, `src/math/affine.ts`
- Test: `packages/runtime/test/node.test.ts`, `test/affine.test.ts`

**Interfaces:**
- Consumes: `Track`, `Ease` (Task 2).
- Produces:
  - `type Affine = [a,b,c,d,e,f]`. `multiply(m: Affine, n: Affine): Affine`, `apply(m: Affine, x: number, y: number): [number, number]`, `IDENTITY`.
  - `interface BaseProps { x:number; y:number; scaleX:number; scaleY:number; rotation:number /*degrees*/; anchorX:number; anchorY:number /*0–1 of node size*/; opacity:number; z:number; blur:number /*px*/; width:number; height:number; radius:number /*clip/corner*/; clip:boolean }`. Defaults: x,y,rotation,z,blur,width,height,radius = 0; scale = 1; anchor = 0; opacity = 1; clip = false.
  - `abstract class Node<P extends BaseProps = BaseProps> { readonly kind: string; readonly name: string; parent?: Node; children: Node[]; path(): string; add<N extends Node>(child: N): N; set(props: Partial<P>, at: number): this; to(props: Partial<P>, opts: { at: number; duration: number; ease?: Ease }): this; propsAt(t: number): P; localMatrix(t: number): Affine }`
  - Factories in `kinds.ts`: `group(props?: Partial<BaseProps> & {name?:string})`, `rect(props?: Partial<BaseProps & {fill:string; stroke:string; strokeWidth:number}> & {name?:string})`, `text(props: Partial<BaseProps & {text:string; fontFamily:string; fontSize:number; fontWeight:number; color:string; lineHeight:number}> & {name?:string})` (defaults: `fontFamily: 'SF Pro Text'`, `fontSize: 48`, `fontWeight: 400`, `color: '#ffffff'`, `lineHeight: 1.2`), `image(props: Partial<BaseProps> & {src: string; fit?: 'fill'|'contain'|'cover'; name?:string})`.
- **Path rule (stable ids, spec §9.4):** `path()` = parent path + `/` + name. Default name = `${kind}${indexAmongSameKindSiblings}` (e.g. `rect0`). Duplicate explicit names among siblings get `~2`, `~3` suffixes in insertion order.

- [ ] **Step 1: Write failing tests:** defaults from `propsAt(0)`. `to({x:100},{at:1,duration:1})` → `propsAt(1.5).x===50`. `set({opacity:0},2)` → `propsAt(2).opacity===0`. `localMatrix` for `{x:10,y:20,rotation:90,width:100,height:50,anchorX:0.5,anchorY:0.5}` maps local point (50,25) to (10,20). Paths: root group `"desktop"` with children `rect()`, `rect()`, `text({name:'title'})`, `text({name:'title'})` → `desktop/rect0`, `desktop/rect1`, `desktop/title`, `desktop/title~2`. `affine.multiply` associativity check on a sample.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** One `Track` per animated prop, created on first `set/to`. `localMatrix = T(x,y)·R(rotation)·S(scaleX,scaleY)·T(-anchorX·width, -anchorY·height)`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(runtime): scene graph nodes with animated props and stable paths`.

### Task 4: Scenes, compositions, layout, seeded RNG

**Files:**
- Create: `packages/runtime/src/composition.ts`, `src/math/random.ts`, `src/index.ts`
- Test: `packages/runtime/test/composition.test.ts`, `test/random.test.ts`

**Interfaces:**
- Consumes: `Node`, `group` (Task 3).
- Produces:
  - `type SceneContext = { root: Node; width: number; height: number; duration: number; random: () => number }` (root = a `group` named after the scene id, sized to the composition).
  - `type SceneDef = { id: string; duration: number /*s*/; background?: string; build: (ctx: SceneContext) => void }`. `scene(id: string, opts: {duration: number; background?: string}, build: SceneDef['build']): SceneDef`
  - `type Composition = { width: number; height: number; fps: number; background: string /*default '#000000'*/; scenes: SceneDef[] }`. `composition(c: Omit<Composition,'background'> & {background?: string}): Composition`
  - `type SceneSpan = { id: string; startFrame: number; endFrame: number /*exclusive*/ }`. `layoutComposition(c: Composition): { totalFrames: number; scenes: SceneSpan[] }` (frames = `Math.round(duration·fps)`, sequential).
  - `clampFrame(c: Composition, frame: number): number` → `[0, max(totalFrames-1, 0)]`
  - `instantiateScene(c: Composition, def: SceneDef): Node` (builds once per (composition, def), cached in a `WeakMap`).
  - `seededRandom(seed: string): () => number` (deterministic, e.g. mulberry32 over a string hash). Scene RNG seed = scene id.
  - `index.ts` re-exports everything public from Tasks 2–5.

- [ ] **Step 1: Write failing tests:** 2 scenes of 2 s and 1.5 s at 30 fps → `totalFrames 105`, spans `[0,60)`, `[60,105)`. `clampFrame(c,-5)===0`, `clampFrame(c,999)===104`. Empty composition → `totalFrames 0`, `clampFrame(c, 10)===0`. `instantiateScene` called twice returns the same object and runs `build` once. `seededRandom('a')` gives the same first 3 values on two instances, and different values from `seededRandom('b')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(runtime): scenes, compositions, layout and seeded RNG`.

### Task 5: Frame evaluation → render list

**Files:**
- Create: `packages/runtime/src/renderlist.ts`, `src/evaluate.ts`
- Test: `packages/runtime/test/evaluate.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  ```ts
  type RectItem  = { kind:'rect';  path:string; matrix:Affine; width:number; height:number; radius:number; fill:string; stroke?:string; strokeWidth:number; opacity:number };
  type TextItem  = { kind:'text';  path:string; matrix:Affine; text:string; fontFamily:string; fontSize:number; fontWeight:number; color:string; lineHeight:number; opacity:number };
  type ImageItem = { kind:'image'; path:string; matrix:Affine; src:string; width:number; height:number; fit:'fill'|'contain'|'cover'; opacity:number };
  type LayerItem = { kind:'layer'; path:string; items:RenderItem[]; opacity:number; blur:number; clip?: { matrix:Affine; width:number; height:number; radius:number } };
  type RenderItem = RectItem|TextItem|ImageItem|LayerItem;
  type RenderList = { width:number; height:number; background:string; items:RenderItem[]; assets:string[] /*image srcs used*/ };
  evaluateFrame(c: Composition, frame: number): RenderList
  collectAssets(c: Composition): string[]  // every image src in every scene (instantiates all scenes), sorted, unique
  ```
- Rules: the frame is clamped. The active scene = span containing the frame. Local time `t = (frame - span.startFrame)/fps`. World matrix = parent world · local. Children sorted by `z` (stable for ties). A node becomes a `LayerItem` (children + itself inside) when `blur > 0`, or `clip` is true, or `opacity < 1` and it has children. Otherwise opacity multiplies down into leaf items. Nodes with effective opacity 0 are omitted. `background` = scene background ?? composition background.

- [ ] **Step 1: Write failing tests:** parent group `to({x:100})` over the scene moves a child rect's matrix translation. Group with `blur: 8` → single `LayerItem` with blur 8 containing the child. `opacity:0.5` on a leaf rect → rect item opacity 0.5, no layer. Hidden (`opacity:0`) nodes omitted. `assets` lists image srcs. `collectAssets` returns srcs from all scenes, not just the active one. **Determinism:** `evaluateFrame(c,45)` deep-equals the result of evaluating frames 0..44 first and then 45. Empty composition → `{items:[], background:'#000000'}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(runtime): evaluate frames into render lists`.

### Task 6: WebGPU renderer

**Files:**
- Create: `packages/runtime/src/gpu/renderer.ts`, `src/gpu/text.ts`, `src/gpu/shaders/rect.wgsl`, `quad.wgsl`, `blur.wgsl`, `composite.wgsl`, `packages/runtime/vitest.browser.config.ts`
- Test: `packages/runtime/test/gpu/renderer.browser.test.ts`

**Interfaces:**
- Consumes: `RenderList` (Task 5).
- Produces:
  - `type AssetMap = Map<string, ImageBitmap>`
  - `createRenderer(canvas: HTMLCanvasElement|OffscreenCanvas, opts?: { device?: GPUDevice }): Promise<Renderer>`
  - `interface Renderer { resize(width:number, height:number): void; render(list: RenderList, assets: AssetMap): void; readPixels(): Promise<Uint8Array> /*RGBA, row-major, for tests and render_frame later*/; destroy(): void }`
  - `class TextRasterizer { raster(item: TextItem, scale: number): ImageBitmap | OffscreenCanvas }`, cached by (text, font, size, weight, color, scale).
- Approach: canvas format `navigator.gpu.getPreferredCanvasFormat()`, premultiplied alpha. Rects use an SDF rounded-rect fragment shader (antialiased edge, optional stroke). Images and text are textured quads (text rasterized at output pixel scale, never scaled up). Layers render into a pooled offscreen texture at canvas size, then a separable Gaussian blur (two passes, sigma = blur/2, kernel radius ≤ 3·sigma), then composite with opacity and rounded clip mask. Missing asset → magenta placeholder quad + a warning, no throw.

- [ ] **Step 1: Configure** Vitest browser mode with Playwright Chromium, launch args `--enable-unsafe-webgpu` (headless Chromium on macOS uses Metal). Command: `pnpm --filter liosvideo test:gpu`.
- [ ] **Step 2: Write failing tests** (256×256 canvas):
  - red rect at (50,50) 100×100 → pixel (100,100) ≈ `[255,0,0,255]` (±2), pixel (10,10) = background.
  - rounded rect radius 50 on a 100×100 → corner pixel (52,52) is background.
  - layer with `blur:10` around a white rect on black → edge pixel at the rect border has 40–215 luminance, while unblurred it is 255/0.
  - text `"Ag"` white at (20,20) size 48 → at least 50 pixels with luminance > 128 in the box (20,20)–(120,90).
  - missing image src → no throw, magenta present.
  - determinism: render frame 45 of a sample animated composition directly vs after rendering 0..44 → `readPixels()` byte-identical.
- [ ] **Step 3: Run** `pnpm --filter liosvideo test:gpu` → FAIL.
- [ ] **Step 4: Implement** the renderer.
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(runtime): WebGPU renderer with rects, text, images, blur layers`.

### Task 7: Rust project backend (path guard, listing, reading, watching)

**Files:**
- Create: `apps/desktop/src-tauri/src/project.rs`, `src-tauri/src/watch.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register commands, managed state), `Cargo.toml` (`notify`, `notify-debouncer-full`, `thiserror`, `serde`), `tauri.conf.json` (asset protocol enabled, scope set at runtime to the open project), capabilities file (dialog plugin `open`)
- Test: inline `#[cfg(test)]` in `project.rs`, using `tempfile`

**Interfaces:**
- Produces (Rust): `fn resolve_in_project(root: &Path, rel: &str) -> Result<PathBuf, ProjectError>` (canonicalizes. Rejects absolute `rel`, `..` escapes, and symlinks resolving outside `root`).
- Produces (Tauri commands, camelCase in JS):
  - `open_project(root: String) -> ProjectInfo { root: String, compositions: Vec<String> }`. Sets the managed current root, sets the asset-protocol scope to `root/**`, starts the watcher.
  - `list_compositions() -> Vec<String>` (root-level `*.ts`, sorted, excluding `*.d.ts`)
  - `read_project_file(rel: String) -> String`
  - `asset_url_path(rel: String) -> String` (absolute path after the guard, for `convertFileSrc` on the JS side)
  - Event `project://changed` with payload `{ paths: string[] }` (project-relative), debounced 100 ms. Ignores `.git/`, `out/`, `.liosvideo/cache/`, `node_modules/`.

- [ ] **Step 1: Write failing tests:** `resolve_in_project(root,"scenes/a.ts")` ok. `"../x"` → Err. `"/etc/passwd"` → Err. A symlink `root/link -> /tmp/outside` then `"link/f"` → Err. `list_compositions` on a temp dir with `long.ts`, `short.ts`, `types.d.ts`, `scenes/intro.ts` → `["long.ts","short.ts"]`.
- [ ] **Step 2: Run** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → FAIL.
- [ ] **Step 3: Implement.** Commands error when no project is open.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(desktop): path-guarded project commands and file watcher`.

### Task 8: Project bundler (esbuild-wasm)

**Files:**
- Create: `apps/desktop/src/lib/bundle/bundler.ts`
- Test: `apps/desktop/src/lib/bundle/bundler.test.ts`

**Interfaces:**
- Consumes: nothing from Rust directly. A `readFile` function is injected (wired to `read_project_file` in Task 10).
- Produces:
  - `type BuildError = { file: string; line: number; column: number; message: string }`
  - `type BuildResult = { ok: true; code: string; files: string[] } | { ok: false; errors: BuildError[] }`
  - `bundleComposition(entry: string, readFile: (rel: string) => Promise<string>): Promise<BuildResult>`. Format `iife`, `globalName: '__liosProject'`, target `es2022`. Plugin: `liosvideo` resolves to a virtual module `module.exports = globalThis.__liosvideo`. Relative imports resolve against the importer, trying `.ts`, `/index.ts`. Any other bare import → build error `"Only 'liosvideo' and relative imports are allowed"`. `files` lists every project file read (used to decide whether a change affects this entry).
  - `class BuildCoordinator { constructor(build: () => Promise<BuildResult>, onResult: (r: BuildResult) => void, debounceMs = 80); trigger(): void }`. Debounces, and drops results from builds started before the most recent completed one (generation counter).

- [ ] **Step 1: Write failing tests** (esbuild-wasm runs in Node via Vitest), with an in-memory file map: `long.ts` importing `./scenes/intro` and `liosvideo` bundles ok, and `files` contains both. A missing import → `ok:false` with `file:'long.ts'`, `line` correct. `import 'fs'` → error message above. A syntax error reports file:line. `BuildCoordinator`: three `trigger()`s within 80 ms → `build` called once. Two builds where the first resolves after the second → `onResult` receives only the second's result.
- [ ] **Step 2: Run** `pnpm --filter desktop vitest run bundler` → FAIL.
- [ ] **Step 3: Implement.** Initialize esbuild-wasm once (lazy singleton, `wasmURL` from the package in the app, default in Node).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(desktop): esbuild-wasm project bundler with debounced builds`.

### Task 9: Sandboxed render worker + PreviewHost

**Files:**
- Create: `apps/desktop/src/lib/preview/render.worker.ts`, `src/lib/preview/protocol.ts`, `src/lib/preview/host.ts`
- Test: `apps/desktop/src/lib/preview/host.test.ts` (logic with a fake worker), `apps/desktop/src/lib/preview/sandbox.browser.test.ts` (Vitest browser mode, real worker)

**Interfaces:**
- Consumes: `createRenderer`, `evaluateFrame`, `layoutComposition`, the whole `liosvideo` module (Tasks 4–6). `BuildResult.code` (Task 8).
- Produces:
  - `protocol.ts`: `type ToWorker = {type:'init'; canvas: OffscreenCanvas} | {type:'load'; code: string; generation: number} | {type:'render'; frame: number; id: number} | {type:'assets'; bitmaps: [string, ImageBitmap][]}`. `type FromWorker = {type:'loaded'; generation: number; width: number; height: number; fps: number; totalFrames: number; scenes: SceneSpan[]; assets: string[] /*collectAssets*/} | {type:'rendered'; id: number; frame: number} | {type:'error'; phase:'load'|'render'; message: string; stack?: string}`
  - `class PreviewHost { constructor(canvas: HTMLCanvasElement, resolveAsset: (src: string) => Promise<ImageBitmap>, makeWorker?: () => Worker); load(code: string): Promise<LoadedInfo>; requestFrame(frame: number): void /*latest wins: at most one in flight + one pending*/; onError(cb: (e: {phase: string; message: string; stack?: string}) => void): void; dispose(): void }`, where `LoadedInfo` = the `loaded` payload minus `type`.
- Worker behavior: sets `globalThis.__liosvideo` to the runtime. **Before evaluating project code**, deletes or overrides `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel`, and nested `Worker` with throwing stubs (`"<name> is not available in scenes"`). Evaluates the bundle with `new Function(code + ';return __liosProject')()`. The default export must be a `Composition`, otherwise error `"Entry file must default-export composition(...)"`. After `loaded`, the host fetches the listed assets via `resolveAsset` and sends them to the worker. On a `load` error the previous composition stays active.
- Watchdog: if `load` or a `render` produces no reply within 5000 ms, the host terminates the worker, creates a fresh one, re-inits a new canvas transfer (replace the `<canvas>` element, since OffscreenCanvas transfer is one-time), and emits error `"Scene code timed out"`.

- [ ] **Step 1: Write failing tests:**
  - host (fake worker): 5 `requestFrame` calls while one is in flight → worker receives the in-flight one + only the last (2 total). `load` error → `onError` called with phase `'load'`. A fake worker that never replies → after 5000 ms (fake timers) `onError('Scene code timed out')` and `makeWorker` called a second time.
  - sandbox (browser): loading code whose scene build calls `fetch('https://example.com')` → error message contains `fetch is not available in scenes`. Code with `export default 42` → entry error message. Valid sample → `loaded` with the right `totalFrames`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** If Task 1 recorded `webgpuInWorker: false`, implement the same protocol over a `sandbox="allow-scripts"` iframe with `postMessage` instead of a Worker, behind `makeWorker`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(desktop): sandboxed render worker and preview host`.

### Task 10: Preview UI, sample project, hot reload

**Files:**
- Create: `apps/desktop/src/lib/preview/clock.ts`, `src/lib/components/Preview.svelte`, `Transport.svelte`, `ErrorOverlay.svelte`, `CompositionSwitcher.svelte`, `ProjectPicker.svelte`
- Modify: app root component (two-pane layout: left pane placeholder "Chat comes in the ACP plan", right pane preview + transport)
- Create: `examples/php2shell-sample/long.ts` (1920×1080@30, 3 scenes), `short.ts` (1080×1920@30, reusing 2 scenes from `scenes/`), `scenes/intro.ts`, `scenes/focus-demo.ts` (a desktop-like group with two window rects: one moves up/front sharp while the other moves down + `blur:12` + opacity 0.6, then reverse, i.e. the user's focus swap from spec §9.1, built from primitives), `scenes/outro.ts`, `assets/images/wall.jpg`, and a `tsconfig.json` with `paths: {"liosvideo": [...]}` for editor typing
- Test: `apps/desktop/src/lib/preview/clock.test.ts`

**Interfaces:**
- Consumes: Tauri commands + event (Task 7), `bundleComposition`/`BuildCoordinator` (Task 8), `PreviewHost` (Task 9).
- Produces:
  - `formatTimecode(frame: number, fps: number): string` → `"MM:SS:FF"`
  - `class PlaybackClock { constructor(fps: number, totalFrames: number); play(nowMs: number): void; pause(nowMs: number): void; seek(frame: number): void; frameAt(nowMs: number): number /*clamped; stops (pauses) at last frame*/; readonly playing: boolean }`

- [ ] **Step 1: Write failing tests:** `formatTimecode(0,30)==='00:00:00'`, `formatTimecode(95,30)==='00:03:05'`, `formatTimecode(3600*30,30)==='60:00:00'`. Clock: `seek(10); play(1000); frameAt(2000)===40` at 30 fps. `pause(2000); frameAt(5000)===40`. Playing past the end returns `totalFrames-1` and `playing===false`. `seek(-3)` → 0.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `clock.ts`, then the components. Picker uses the dialog plugin to select a folder → `open_project`. The switcher lists `compositions` (default `long.ts` if present). Preview keeps a canvas with the composition's aspect ratio letterboxed in the pane, with internal canvas size = composition size × min(1, paneDevicePixels/compositionPixels). Transport has play/pause (Space), ←/→ frame step, a scrub bar with scene span markers from `loaded.scenes`, and a timecode. `rAF` loop → `clock.frameAt(now)` → `host.requestFrame`. On `project://changed`, if any changed path ∈ the last build's `files` (or is a new root `*.ts`, which refreshes the switcher) → `BuildCoordinator.trigger()` → `host.load` → re-request the current frame (playhead preserved, clamped to the new length). `ErrorOverlay` shows build errors (file:line:col + message) or worker errors over the last good frame. It clears on the next successful load.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Manual verification** in `pnpm --filter desktop tauri dev` with `examples/php2shell-sample`:
  - `long.ts` and `short.ts` both render, and switching changes the aspect ratio.
  - Scrubbing to any frame is instant and matches playing to it.
  - The focus-demo swap animates with visible blur.
  - Editing `scenes/focus-demo.ts` (change a color) shows up in ≤2 s with the playhead unchanged.
  - Introducing a syntax error shows the overlay with file:line, and the last frame stays. Fixing it clears the overlay.
  - `while(true){}` in a scene → "Scene code timed out" within ~5 s, and the app stays responsive. Removing it recovers.
  
  Record the results in `docs/superpowers/notes/2026-10-27-foundation-verification.md`.
- [ ] **Step 6: Commit** `feat(desktop): live preview with transport, hot reload and error overlay`.

---

## Later plans (not in this plan)

2. Realistic mockups + `focus()` + golden-image tests (spec §9.2). 3. Timeline manifest + timeline UI (§9.4, §6). 4. Project create/scaffold + git history (§7, §12). 5. ACP agent detection/setup, chat, editor MCP server (§8). 6. Audio/TTS/recording (§10). 7. Export (§11). 8. Shader node, transitions, Shorts helpers (§9.1, §14.8).
