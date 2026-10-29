# liosvideo Project Guide

This repository contains a **liosvideo** declarative video project. Videos are authored as deterministic TypeScript code; the liosvideo desktop application renders them in real-time with WebGPU, synchronizes high-fidelity Web Audio narration and music, and provides live hot-reloading.

---

## Directory Layout

```
long.ts                     # 16:9 composition (YouTube / Presentation)
short.ts                    # 9:16 composition (Shorts / Reels / TikTok)
scenes/                     # Scene modules, reusable across compositions
  intro.ts
  features.ts
  outro.ts
script.md                   # Researched script with stable line IDs
assets/
  images/                   # External images (PNG, JPEG, WebP, SVG)
  video/                    # Video clips (MP4, WebM)
  fonts/                    # Custom web fonts (WOFF2, TTF)
  audio/
    vo/                     # Narration audio clips + word-level timing JSON
    music/                  # Background music & sound effects
.liosvideo/
  project.json              # Project metadata & audio manifest
out/                        # Rendered MP4 video exports (gitignored)
```

---

## Compositions

Any `*.ts` file at the project root default-exporting `composition(...)` is a renderable output:

```ts
import { composition, transition } from "liosvideo";
import intro from "./scenes/intro";
import demo from "./scenes/demo";
import outro from "./scenes/outro";

export default composition({
  width: 1920,
  height: 1080,
  fps: 30,
  background: "#0b0d12",
  scenes: [
    intro,
    demo,
    outro
  ],
  transitions: [
    transition("fade", { duration: 0.5 }),
    transition("slide", { duration: 0.4, direction: "left" })
  ],
  audio: [
    {
      id: "bgm",
      src: "assets/audio/music/ambient.mp3",
      startAt: 0,
      volume: 0.25,
      loop: true
    }
  ]
});
```

- **Transitions**: Supported primitives are `"fade"`, `"slide"`, `"zoom"`, and `"wipe"`.
  - Options: `{ duration: number, direction?: "left" | "right" | "up" | "down" }`.
- **Audio tracks**: Compositions support arbitrary audio tracks with `startAt`, `volume`, and `loop`.

---

## Scenes

Each scene is a self-contained module created using `scene(id, config, builder)`:

```ts
import { group, image, rect, scene, text, vo } from "liosvideo";

export default scene(
  "intro",
  { duration: 4.5, background: "#0b0d12" },
  ({ root, width, height, duration, random }) => {
    // Background card
    const card = root.add(
      rect({
        name: "card",
        width: width * 0.8,
        height: height * 0.6,
        x: width / 2,
        y: height / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        radius: 24,
        fill: "#161b22",
        stroke: "#30363d",
        strokeWidth: 2,
        opacity: 0
      })
    );
    card.to({ opacity: 1 }, { at: 0.2, duration: 0.4, ease: "outCubic" });

    // Title
    const title = card.add(
      text({
        name: "title",
        text: "Autonomous Video Creation",
        fontSize: Math.min(width * 0.04, 56),
        fontWeight: 700,
        color: "#ffffff",
        x: card.width / 2,
        y: card.height / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 0
      })
    );
    title.to({ opacity: 1, y: card.height / 2 - 20 }, { at: 0.4, duration: 0.5, ease: "outBack" });

    // Voice-over synchronization with vo() helper
    const narration = vo("intro-line-1");
    if (narration.isReady) {
      // Highlight a keyword exactly when spoken
      const keywordTime = narration.wordTime("autonomous");
      if (keywordTime !== undefined) {
        title.to({ color: "#38bdf8" }, { at: keywordTime, duration: 0.2 });
      }
    }
  }
);
```

### Context Parameters
- `root`: Root group matching composition resolution.
- `width`, `height`: Dynamic dimensions (write responsive code that works in both 16:9 and 9:16).
- `duration`: Scene duration in seconds.
- `random()`: Seeded deterministic pseudo-random number generator (`0` to `1`).

---

## Node Primitives

| Type | Builder | Key Properties |
| :--- | :--- | :--- |
| **Group** | `group(props)` | `x, y, width, height, anchorX, anchorY, scaleX, scaleY, rotation, opacity, blur, z, clip, radius` |
| **Rect** | `rect(props)` | Group properties plus `fill, stroke, strokeWidth` |
| **Circle** | `circle(props)` | Group properties plus `radius, fill, stroke, strokeWidth` (creates perfect circles/avatars/dots) |
| **Path** | `path(props)` | Group properties plus `d (SVG path string), fill, stroke, strokeWidth` (triangles, polygons, custom vector paths) |
| **Shader** | `shader(props)` | Group properties plus `code (raw WGSL fragment shader), uniforms` (procedural effects, gradients, noise) |
| **Text** | `text(props)` | Group properties plus `text, fontFamily, fontSize, fontWeight, color, lineHeight, letterSpacing` |
| **Image** | `image(props)` | Group properties plus `src` (project-relative path), `fit ("fill" \| "contain" \| "cover")` |
| **Three (3D)** | `three(props)` | Group properties plus `camera ("perspective" \| "orthographic"), fov, setup({ scene, camera, width, height }), update(state, progress, time)` (Three.js 3D scenes, meshes, lights, materials) |
| **Phone** | `phone(props)` | Smartphone device frame for 9:16 mobile compositions with bezel, screen, dynamic island, and home indicator |

### 3D Scenes with Three.js
Liosvideo supports deterministic 3D scenes via Three.js. You can import Three.js with `import * as THREE from "three"` and use the `three(...)` primitive:

```ts
import { scene, three } from "liosvideo";
import * as THREE from "three";

export default scene("showcase-3d", { duration: 5 }, ({ root, width, height }) => {
  const cube = root.add(
    three({
      name: "cube-3d",
      width: 600,
      height: 600,
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      setup({ scene, camera }) {
        camera.position.z = 4;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 1.5, 1.5),
          new THREE.MeshStandardMaterial({ color: "#7aa2f7" })
        );
        scene.add(mesh);
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(2, 2, 5);
        scene.add(light);
        return { mesh };
      },
      update({ mesh }, progress, time) {
        mesh.rotation.x = time * 1.2;
        mesh.rotation.y = time * 1.8;
      }
    })
  );
});
```

### Custom Mockups & Components
Agents can create domain-specific mockups (smartwatches, tablet frames, notification bubbles, custom app UIs) by authoring composite functions or classes extending `GroupNode` using `group()`, `rect()`, `circle()`, `path()`, and `text()`.

---

## Custom Transitions

In compositions, you can use built-in transitions or custom transition callbacks:

```ts
// Built-in transitions
transition("slide", { duration: 0.5, direction: "left" }) // "left" | "right" | "up" | "down"
transition("fade", { duration: 0.4 })
transition("zoom", { duration: 0.6 })

// Custom transition callback:
transition((node, progress, width, height) => {
  (node as any).base.rotation = progress * 360;
  (node as any).base.scaleX = progress;
  (node as any).base.scaleY = progress;
  (node as any).base.opacity = progress;
}, 0.75);
```

---

## Keyframing & Animation

Animate properties over time with `node.to(...)` or snap instantly with `node.set(...)`:

```ts
// Smooth transition
node.to({ opacity: 1, scaleX: 1, scaleY: 1 }, {
  at: 1.0,           // Time in seconds from start of scene
  duration: 0.6,     // Duration in seconds
  ease: "outCubic"   // Easing function
});

// Instant change
node.set({ fill: "#22c55e" }, 2.5);
```

### Supported Easings
- `"linear"`
- `"inQuad"`, `"outQuad"`, `"inOutQuad"`
- `"inCubic"`, `"outCubic"`, `"inOutCubic"` (default)
- `"outBack"` (slight overshoot, ideal for entrance animations)
- `"inOutExpo"`
- Custom curve: `(t: number) => number`

---

## Audio & Narration Workflow

1. **Script (`script.md`)**: Maintain concise narration with stable identifiers:
   ```markdown
   <!-- vo:intro-line-1 -->
   Welcome to liosvideo, the deterministic code-first video engine.
   ```
2. **Generating Audio**:
   - Use MCP tool `tts_generate` or live ElevenLabs voice synthesis.
   - Audio is saved to `assets/audio/vo/<id>.mp3` with word-level alignments in `.liosvideo/project.json`.
3. **In-App Voice Recording**:
   - Voice lines recorded directly in the app are automatically saved and transcribed with timestamps.
4. **Timing Sync with `vo(id)`**:
   - `vo(id).duration`: Exact audio duration in seconds.
   - `vo(id).wordTime(word)`: Second offset when a specific word is spoken.

---

## Editor MCP Server Tools

When interacting as an AI agent via ACP (Claude Code, Gemini CLI, Codex), use the built-in Editor MCP tools:

- `inspect_manifest`: Read current composition duration, scene list, and audio tracks.
- `get_node_path`: Resolve element hierarchy and bounding boxes for targeted edits.
- `tts_list_voices`: List available local and cloud narration voices.
- `tts_generate`: Synthesize speech with word-level timestamps.
- `capture_frame`: Capture a PNG frame at timestamp `t` for visual verification.
- `validate_scene`: Validate scene TypeScript code against deterministic rendering rules, illegal imports, node naming constraints, and asset existence.

---

## Screenshot & Visual Verification

Before declaring an edit complete:
1. Verify scene layout using visual snapshots:
   - Capture a reference frame: compare current render against expected design.
   - Check difference overlays in the desktop UI preview (`blend` or `difference` mode).
2. Ensure no layout overflows or text wrapping collisions occur between 16:9 and 9:16 aspect ratios.

---

## Development Constraints & Rules

1. **Pure & Deterministic**:
   - No `Math.random()`, `Date.now()`, or asynchronous promises inside `scene` builders.
   - Use `random()` from the scene builder callback.
2. **Strict Import Scope**:
   - Only import `liosvideo` and relative project files.
   - Do not import external npm packages or use Node.js standard libraries.
3. **Naming Consistency**:
   - Always give meaningful `name` attributes to nodes (`card`, `title`, `badge`, `avatar`).
   - Do not use `/` inside node names; path segments use `/` as delimiters.
4. **Targeted Revisions**:
   - When the user selects a node or timestamp range in the timeline, edit only the affected scene and elements.
   - Keep unchanged scenes intact to preserve render cache.
