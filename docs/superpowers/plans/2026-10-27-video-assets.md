# External Video Asset Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable external video assets (MP4, WebM, screen recordings) in `@liosvideo/runtime` and the desktop preview so users and ACP agents can place and play video recordings inside scenes, mockups (Chrome, Terminal, Desktop), or fullscreen.

**Architecture:** Add `VideoNode` and `video()` helper to `@liosvideo/runtime`, outputting `VideoItem` (`kind: "video"`) in `evaluateFrame` with frame-accurate video timestamp calculation (`time = (t * speed) + startOffset`). Update `collectAssets` to identify video sources alongside image sources. Add video frame extraction in `apps/desktop/src/lib/preview/assets.ts` and `host.ts` to supply frame bitmaps to the WebGPU renderer.

**Tech Stack:** TypeScript, `@liosvideo/runtime` scene graph, WebGPU `copyExternalImageToTexture`, HTMLVideoElement / ImageBitmap, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-liosvideo-design.md` (§9.1 video clips & §9.2 mockup window content).

## Global Constraints

- Must run deterministically: `evaluateFrame` computes exact `time = (t * speed) + startOffset` for any given composition frame.
- Supports `fit: "fill" | "contain" | "cover"`.
- Must compose seamlessly with existing mockups (`chrome`, `desktop`, `window`).
- All existing tests in `packages/runtime` and `apps/desktop` must continue to pass.

---

### Task 1: `VideoNode` and `video()` Helper in Runtime

**Files:**
- Modify: `packages/runtime/src/graph/kinds.ts`
- Modify: `packages/runtime/src/renderlist.ts`
- Modify: `packages/runtime/src/evaluate.ts`
- Modify: `packages/runtime/src/index.ts`
- Create: `packages/runtime/test/video.test.ts`

**Interfaces:**
- Produces:
  - `VideoProps`: Extends `BaseProps`. Adds `src: string`, `fit: ImageFit`, `startOffset: number`, `speed: number`, `loop: boolean`.
  - `VideoNode`: Extends `Node<VideoProps>`.
  - `video(init: NodeInit<VideoProps> & { src: string }): VideoNode`.
  - `VideoItem`: In `renderlist.ts`. `{ kind: "video", path: string, matrix: Affine, src: string, time: number, width: number, height: number, fit: ImageFit, opacity: number }`.
  - `evaluateFrame`: Emits `VideoItem` when evaluating a `VideoNode`.
  - `collectAssets`: Includes `VideoNode` sources in the collected asset list.

- [ ] **Step 1: Write failing unit test for `VideoNode` and evaluation**

Create `packages/runtime/test/video.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { video, VideoNode } from "../src/graph/kinds";
import { collectAssets, evaluateFrame } from "../src/evaluate";
import { composition, scene } from "../src/composition";

describe("VideoNode", () => {
  it("creates VideoNode with source, timing and speed props", () => {
    const v = video({ src: "assets/demo.mp4", width: 1280, height: 720, startOffset: 2.0, speed: 1.5 });
    expect(v).toBeInstanceOf(VideoNode);
    expect(v.propsAt(0).src).toBe("assets/demo.mp4");
    expect(v.propsAt(0).startOffset).toBe(2.0);
    expect(v.propsAt(0).speed).toBe(1.5);
  });

  it("evaluates VideoItem with calculated timestamp", () => {
    const sc = scene("intro", ({ root }) => {
      root.add(video({ src: "assets/demo.mp4", width: 1280, height: 720, startOffset: 1.0, speed: 2.0 }));
    }, { duration: 5.0 });

    const comp = composition({ width: 1920, height: 1080, fps: 30, scenes: [sc] });
    expect(collectAssets(comp)).toContain("assets/demo.mp4");

    // Frame 30 = 1.0s in composition. Video time should be startOffset (1.0) + 1.0 * speed (2.0) = 3.0s
    const list = evaluateFrame(comp, 30);
    const item = list.items.find((i) => i.kind === "video");
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      kind: "video",
      src: "assets/demo.mp4",
      time: 3.0,
      width: 1280,
      height: 720,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter liosvideo test test/video.test.ts`
Expected: FAIL (`video` not exported / kinds not defined).

- [ ] **Step 3: Implement `VideoNode`, `VideoItem`, and update `evaluate.ts`**

1. In `packages/runtime/src/graph/kinds.ts`:
   Define `VideoProps`, `VideoNode`, and `video()` factory.
2. In `packages/runtime/src/renderlist.ts`:
   Add `VideoItem` to `RenderItem` union.
3. In `packages/runtime/src/evaluate.ts`:
   Add `VideoNode` handling to `drawable()` calculating `time = (t * p.speed) + p.startOffset`.
   Add `VideoNode` source collection in `collectAssets()`.
4. In `packages/runtime/src/index.ts`:
   Ensure `VideoNode` and `video` are exported.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter liosvideo test test/video.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/ packages/runtime/test/video.test.ts
git commit -m "feat(runtime): VideoNode and VideoItem evaluation with frame timestamps"
```

---

### Task 2: WebGPU Renderer Support for Video Items

**Files:**
- Modify: `packages/runtime/src/gpu/renderer.ts`
- Modify: `packages/runtime/test/evaluate.test.ts`

**Interfaces:**
- Updates `packages/runtime/src/gpu/renderer.ts`:
  - `Leaf = RectItem | TextItem | ImageItem | VideoItem`.
  - In `writeInstance`: handle `leaf.kind === "video"` by retrieving the asset bitmap/frame from `assets.get(video.src)` (keyed by source or frame key) and uploading via `uploadSource`.
  - Fallback placeholder if asset not loaded (magenta solid rect with warning).

- [ ] **Step 1: Write unit test verifying renderlist includes video items**

Add test in `packages/runtime/test/evaluate.test.ts`:
Verify `renderlist.items` contains `VideoItem` and renderer type accepts it.

- [ ] **Step 2: Update `packages/runtime/src/gpu/renderer.ts`**

Update `writeInstance` and type `Leaf` to include `VideoItem`.

- [ ] **Step 3: Run all runtime tests to verify they pass**

Run: `pnpm --filter liosvideo test`
Expected: PASS with 100% green.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/gpu/renderer.ts packages/runtime/test/
git commit -m "feat(runtime): WebGPU renderer support for video items"
```

---

### Task 3: Desktop Preview Video Asset Loader & Sample

**Files:**
- Modify: `apps/desktop/src/lib/preview/assets.ts`
- Modify: `apps/desktop/src/lib/preview/host.ts`
- Modify: `apps/desktop/src/lib/preview/render.worker.ts`
- Test: `apps/desktop/src/lib/preview/host.test.ts`

**Interfaces:**
- Produces:
  - Video asset loader in `assets.ts`: supports `.mp4`, `.webm`, `.mov` files through HTMLVideoElement frame sampling.
  - Passes video frame bitmap into `AssetMap`.

- [ ] **Step 1: Write test for video asset detection in host**

Update `apps/desktop/src/lib/preview/host.test.ts` to verify video assets in `collectAssets` are forwarded to the worker.

- [ ] **Step 2: Update `assets.ts` and `host.ts`**

Support video sources in `resolveAsset`:
If file is a video, use an offscreen `HTMLVideoElement` seeked to the requested time, or frame extractor.

- [ ] **Step 3: Run desktop tests and checks**

Run: `pnpm --filter desktop test`
Run: `pnpm --filter desktop check`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/preview/
git commit -m "feat(desktop): video asset resolution and frame delivery to render worker"
```
