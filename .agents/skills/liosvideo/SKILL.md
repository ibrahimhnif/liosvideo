---
name: liosvideo
description: Master video director skill for liosvideo. Use whenever creating, scripting, animating, voicing, transitioning, or revising declarative TypeScript WebGPU videos.
---

# liosvideo Director Skill

You are an expert motion designer and director using **liosvideo**, a code-first, deterministic declarative video platform powered by WebGPU, Web Audio, and WebCodecs.

Use this skill whenever:
- Designing or scripting a new video project.
- Creating or editing scenes, node hierarchies, and animations.
- Adding or timing voice narration (`vo()`), sound effects, and background music.
- Applying scene transitions (`fade`, `wipe`, `slide`, `zoom`).
- Verifying layout and visual quality using diffs or frame captures.

---

## 1. Core Principles

1. **Deterministic & Frame-Pure**:
   - Every frame at timestamp `t` must render identically every time.
   - Never use `Math.random()`, `Date.now()`, `performance.now()`, `requestAnimationFrame()`, or asynchronous promises inside scene builders and 3D update loops.
   - Use the seeded `random()` function passed into the scene context, and the `time` / `progress` arguments in `three({ update })`.

2. **Responsive Composition**:
   - Scenes should cleanly adapt between **16:9** (`1920x1080`) and **9:16** (`1080x1920`).
   - Use dynamic coordinates derived from `width` and `height`, and anchor points (`anchorX: 0.5, anchorY: 0.5` for center-aligned elements).

3. **Stable Node Naming**:
   - Assign semantic `name` attributes to all actionable nodes (`card`, `headline`, `highlight`, `badge`).
   - Node names form slash-separated paths (e.g. `scene-id/card/headline`).
   - Never use `/` in node names.
   - Keep names stable across iterations so user timeline selections survive code edits.

4. **Targeted Revisions**:
   - When revising an existing video based on user feedback or timeline selection, only modify the target scene and nodes.
   - Preserve existing timings and unaffected scenes to leverage the runtime's granular caching.

---

## 2. Project Architecture

```
long.ts                     # 16:9 landscape composition
short.ts                    # 9:16 portrait composition
scenes/                     # Scene modules
  intro.ts
  showcase.ts
  outro.ts
script.md                   # Video script with tagged narration blocks
assets/
  images/                   # External illustrations, screenshots, icons
  video/                    # Video clips (MP4/WebM)
  fonts/                    # Custom web fonts (WOFF2/TTF)
  audio/
    vo/                     # Synthesized voice lines (.mp3 + word timings)
    music/                  # Background music & sound effects
.liosvideo/
  project.json              # Audio manifest & metadata
out/                        # Final MP4 export destination
```

### Workspace Stage Tabs
The liosvideo desktop application features three distinct stage tabs for seamless workflow:
- **[ 🎬 Preview ]**: Real-time WebGPU viewport, timeline scrubber, playback controls, reference image difference overlays (`blend` / `difference`), and frame snapshots.
- **[ 📝 Script ]**: Dedicated script viewer for `script.md`. Visualizes narration lines (`<!-- vo:id -->`) as interactive cards with audio durations, word counts, and estimated reading speeds.
- **[ 💻 Code ]**: In-app code viewer with file explorer sidebar (`long.ts`, `short.ts`, `scenes/*.ts`), syntax highlighting, line numbers, and fast copy/reload capabilities.

### Archetypes & Creative Style Guides
When creating or restyling scenes, consult the modular skill guides inspired by HyperFrames:
- **`skills/creative/SKILL.md`**: Color harmony tokens (`Tokyo Night`, `Dark Tech 3D`, `SaaS Slate`, `Kinetic High-Contrast`), typography ratios, and motion easing standards.
- **`theme.ts`**: Use semantic tokens (`theme.colors.*`, `theme.fonts.*`, `theme.easing.*`) to keep scenes consistent.
- **Scene Blueprints (`skills/blueprints/`)**:
  - `screencast.md`: Terminal prompt typing, code spotlight, and micro-zoom.
  - `product-3d.md`: Three.js 3D hero setup, lighting, and floating spec chips.
  - `kinetic-short.md`: 9:16 mobile phone mockup, word-sync highlighting, and pop animations.
  - `saas-launch.md`: macOS browser window (`chrome()`), metric chips, and CTA banner.

---

## 3. Compositions & Scene Transitions

Compositions chain scenes together and define transitions and audio tracks:

```ts
import { composition, transition } from "liosvideo";
import intro from "./scenes/intro";
import showcase from "./scenes/showcase";
import outro from "./scenes/outro";

export default composition({
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b0d12",
  scenes: [intro, showcase, outro],
  transitions: [
    transition("slide", { duration: 0.5, direction: "left" }),
    transition("fade", { duration: 0.4 })
  ],
  audio: [
    {
      id: "ambient-bgm",
      src: "assets/audio/music/ambient.mp3",
      startAt: 0,
      volume: 0.2,
      loop: true
    }
  ]
});
```

### Transition Types
- `"fade"`: Smooth cross-fade between outgoing and incoming scenes.
- `"slide"`: Slides the incoming scene in from the specified direction (`"left" | "right" | "up" | "down"`).
- `"zoom"`: Scaled zoom transition (incoming zooms in from center).
- `"wipe"`: Directional wipe revealing the incoming scene.
- **Custom Transition Callback**:
  ```ts
  transition((node, progress, width, height) => {
    (node as any).base.rotation = progress * 360;
    (node as any).base.scaleX = progress;
    (node as any).base.opacity = progress;
  }, 0.75);
  ```

---

## 4. Custom Mockups, Shapes, Shaders & 3D

### Geometric Primitives
- `circle({ radius: 50, fill: "#38bdf8" })`: Creates perfect circles for avatars, indicators, or floating particles.
- `path({ d: "M 0 0 L 100 0 L 50 86 Z", fill: "#f59e0b" })`: Vector SVG paths for triangles, stars, badges, and custom polygons.
- `rect({ width, height, radius, fill, stroke })`: Basic rectangles with rounded borders.

### Raw WGSL Custom Shaders
Use `shader(...)` for custom procedural graphics, animated backgrounds, audio-reactive ripples, or post-processing:
```ts
const effect = root.add(
  shader({
    name: "aurora",
    width,
    height,
    code: `
      @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
        let col = 0.5 + 0.5 * cos(uv.xyx + vec3f(0.0, 2.0, 4.0));
        return vec4f(col, 1.0);
      }
    `,
    uniforms: { speed: 1.0 }
  })
);
```

### Deterministic 3D Scenes with Three.js (`three`)
Liosvideo integrates Three.js directly into the WebGPU render pipeline. 3D objects are rendered deterministically onto an offscreen canvas and composited as transformable nodes with opacity, anchoring, and keyframed transitions:

Import Three.js:
```ts
import { scene, three } from "liosvideo";
import * as THREE from "three";
```

Key Properties:
- `width`, `height`: Render resolution of the 3D canvas.
- `camera`: Camera type (`"perspective"` or `"orthographic"`). Defaults to `"perspective"`.
- `fov`: Field of view in degrees (defaults to `50`).
- `setup({ scene, camera, width, height })`: Pure setup callback creating geometries, materials, meshes, and lights. Returns a custom state object passed into `update`.
- `update(state, progress, time)`: Frame-pure animation step function.
  - `progress`: `0.0` to `1.0` normalized scene progress.
  - `time`: Current scene timestamp in seconds.
  - **Rule**: Never use `requestAnimationFrame()`, `Date.now()`, or internal Three.js clocks. Derive all motion deterministically from `time` or `progress`.

```ts
const globe = root.add(
  three({
    name: "interactive-globe",
    width: 600,
    height: 600,
    x: width / 2,
    y: height / 2,
    anchorX: 0.5,
    anchorY: 0.5,
    camera: "perspective",
    fov: 45,
    setup({ scene, camera }) {
      camera.position.set(0, 0, 4);

      const geometry = new THREE.IcosahedronGeometry(1.4, 2);
      const material = new THREE.MeshStandardMaterial({
        color: "#60a5fa",
        wireframe: true,
        roughness: 0.1
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      const light = new THREE.DirectionalLight(0xffffff, 2);
      light.position.set(2, 3, 4);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0x1e293b, 1));

      return { mesh };
    },
    update({ mesh }, progress, time) {
      mesh.rotation.x = time * 0.5;
      mesh.rotation.y = time * 1.0;
    }
  })
);

// Standard keyframing applies to the ThreeNode itself:
globe.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.3, duration: 0.6, ease: "outBack" });
```

### Authoring Custom Mockups
Never hesitate to build custom domain components (smartwatches, game consoles, notification badges, dialog modals) by authoring modular helper functions in `scenes/components/` that return a configured `GroupNode`.

---

## 5. Scene Authoring & Hierarchy

```ts
import { group, image, rect, scene, text, vo } from "liosvideo";

export default scene(
  "intro",
  { duration: 4.0, background: "#0b0d12" },
  ({ root, width, height, duration, random }) => {
    // 1. Container Card
    const card = root.add(
      rect({
        name: "card",
        width: Math.min(width * 0.85, 1200),
        height: Math.min(height * 0.7, 700),
        x: width / 2,
        y: height / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        radius: 20,
        fill: "#161b22",
        stroke: "#30363d",
        strokeWidth: 2,
        opacity: 0,
        scaleX: 0.9,
        scaleY: 0.9
      })
    );

    // Entrance animation
    card.to(
      { opacity: 1, scaleX: 1, scaleY: 1 },
      { at: 0.2, duration: 0.6, ease: "outBack" }
    );

    // 2. Headline Text
    const title = card.add(
      text({
        name: "title",
        text: "Building the Future of Video",
        fontSize: Math.min(width * 0.045, 52),
        fontWeight: 700,
        color: "#f0f6fc",
        x: card.width / 2,
        y: card.height / 2 - 40,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 0
      })
    );

    title.to(
      { opacity: 1, y: card.height / 2 - 60 },
      { at: 0.5, duration: 0.5, ease: "outCubic" }
    );

    // 3. Audio Synchronization with vo()
    const voiceLine = vo("intro-line-1");
    if (voiceLine.isReady) {
      // Highlight exact word when spoken
      const highlightTime = voiceLine.wordTime("future");
      if (highlightTime !== undefined) {
        title.to({ color: "#58a6ff" }, { at: highlightTime, duration: 0.25 });
      }
    }
  }
);
```

### Built-In Realistic Mockups
- `desktop`: macOS wallpaper, menu bar, and window layout.
- `window`: macOS window with native titlebar and traffic light controls.
- `chrome`: Tab strip, omnibox, and web content area.
- `terminal`: Realistic terminal with prompt, command typing, and ANSI styling.
- `editor`: VS Code-style editor window with line numbers and syntax styling.
- `cursor`: macOS pointer with animated cursor movement and click effects.
- `focus()`: Depth-of-field focus effect (dim/blur background, pop foreground window).
- `phone`: Modern smartphone device frame for 9:16 mobile compositions (Shorts, Reels, TikTok).

---

## 6. Audio & Voice-Over Synchronization

### Narration Workflow
1. Write the script in `script.md` using stable HTML comments:
   ```markdown
   <!-- vo:intro-line-1 -->
   Welcome to liosvideo, the next evolution in video creation.
   ```
   *Note: In the Liosvideo desktop workspace, switch to the **[ 📝 Script ]** tab to view your parsed voice lines, word count, and estimated duration.*
2. Generate narration audio:
   - Call `tts_generate` via MCP tool with `{ id: "intro-line-1", text: "..." }`.
   - The engine automatically saves `assets/audio/vo/intro-line-1.mp3` and records word-level timestamp alignments in `.liosvideo/project.json`.
3. In code:
   - Call `const line = vo("intro-line-1");`
   - `line.duration`: Exact line duration.
   - `line.wordTime("evolution")`: Precise second offset for on-beat animation triggers.

---

## 7. MCP Editor Tools

When operating as an AI agent connected via ACP:
- `inspect_manifest`: Get overall project status, total duration, scenes, and audio tracks.
- `get_node_path`: Inspect hierarchy paths and computed positions of nodes on stage.
- `tts_list_voices`: Query available local and cloud TTS voices.
- `tts_generate`: Synthesize speech clips with automatic word alignment data.
- `capture_frame`: Capture a PNG snapshot at any timestamp for visual inspection.
- `validate_scene`: Validate scene TypeScript code against deterministic rendering rules, illegal imports, node naming constraints, and asset existence.

---

## 8. Verification & Visual Diffing

Before marking tasks complete:
1. **Layout Check**:
   - Verify coordinates with both landscape (16:9) and portrait (9:16) compositions.
   - Ensure texts have appropriate line wrapping and do not collide with edges.
2. **Visual Inspection**:
   - Compare rendered frames against reference design screenshots using the desktop preview's visual diff overlay (`blend` or `difference` mode).
3. **Audio-Visual Sync**:
   - Ensure key animation hits (`title.to`, punch-in zooms, keyword highlights) align accurately with `vo().wordTime()` timestamps.

---

## 9. Agent Troubleshooting & Authentication

When using the built-in Claude agent or ACP integration:
- **OAuth Session Expired**: If the chat interface reports an expired OAuth session or authentication failure, an interactive Action Card appears directly in the chat panel with one-click actions:
  - **Reconnect**: Attempts to refresh the current OAuth session.
  - **Login via Terminal**: Launches your system terminal (macOS Terminal, Windows CMD, or Linux terminal) running `claude login` to re-authenticate the Claude CLI directly.
  - **Set API Key**: Opens the Settings modal to supply a direct `ANTHROPIC_API_KEY` as fallback.
