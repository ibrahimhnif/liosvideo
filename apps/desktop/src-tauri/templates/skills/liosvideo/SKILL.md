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
   - Place every element with `layout({ width, height })` — named slots, `L.cell`, `stack()` and the `L.type` scale — instead of hand-computed pixels; see *Layout Grid* in §5. It keeps the safe area and the rhythm unit for you.

3. **Stable Node Naming**:
   - Assign semantic `name` attributes to all actionable nodes (`card`, `headline`, `highlight`, `badge`).
   - Node names form slash-separated paths (e.g. `scene-id/card/headline`).
   - Never use `/` in node names.
   - Keep names stable across iterations so user timeline selections survive code edits.

4. **Targeted Revisions**:
   - When revising an existing video based on user feedback or timeline selection, only modify the target scene and nodes.
   - Preserve existing timings and unaffected scenes to leverage the runtime's granular caching.

5. **Git Commit Co-Author Attribution**:
   - Always attribute the AI assistant as a co-author trailer in git commits:
     ```
     Co-authored-by: Antigravity <antigravity@deepmind.google>
     ```
     (or matching the active agent: `Co-authored-by: Claude <noreply@anthropic.com>`, etc.).

6. **Plan the Length**:
   - Total duration is `Σ scene.duration` — pick a target before writing scenes.
   - 9:16 short/reel: **20–45 s** (5–9 scenes). 16:9 explainer/product: **60–180 s** (6–12 scenes).
   - Size the script to the target (~2.4 words/s) and derive each scene from its narration (`vo.duration + 0.6 s`, minimum 2.5 s). Never ship the 3 s scaffold stub.

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
  - `documentation-longform.md`: chaptered **15–60 min** documentation/course structure — chapter cards, progress, beat sheets and range rendering.

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

### Scene Timing from Narration (`scene({ vo })`)

Let the narration set the scene length and the cue times; don't keep a hand-made timeline script:

```ts
import { scene, text } from "liosvideo";

export default scene("hook", { vo: ["h1", "h2"], pad: 0.4 }, ({ root, cue, word }) => {
  const title = root.add(text({ name: "title", text: "DIKTATOR PALING KEREN", opacity: 0 }));
  title.to({ opacity: 1 }, { at: word("h1", "diktator") - 0.2, duration: 0.3 }); // scene-local seconds
  title.to({ opacity: 0 }, { at: cue("h2") - 0.2, duration: 0.3 });
});
```

- The lines are spoken back to back: `lead` before the first, `gap` between lines (default 0.3 s), `tail` after the last; `pad` sets `lead` and `tail` together (default 0.35 s). The duration is `lead + lines + gaps + tail`, so a regenerated VO line resizes the scene with no code change. An explicit `duration` still wins.
- `cue(id)` is when the line starts in this scene; `word(id, "word")` when a word starts (first exact match, then first word starting with the text; case and punctuation ignored); `word(id, 3)` takes the 4th word. A typo throws and lists the line's words.
- The composition places each line's audio (`assets/audio/vo/<id>.mp3`, role `vo`) at its scene start + cue. Don't list those clips yourself; set their level with `composition({ narration: { volume: 0.9 } })`, or turn it off with `narration: false`. A clip you already list for the same file is left alone.
- A line with no audio yet counts as 2.5 s so the scene still previews; generate it and the timing follows.
- Captions on the same timing: `captions(root, { lines: ["h1", "h2"].map((id) => ({ id, at: cue(id) })) })`.

### Karaoke Captions (`captions`)

Use the built-in component; don't hand-roll caption helpers:

```ts
import { captions, scene, vo } from "liosvideo";

export default scene("hook", { duration: vo("h1").duration + vo("h2").duration + 1 }, ({ root }) => {
  captions(root, { lines: ["h1", "h2"] });            // VO line ids, spoken back to back (gap 0.3 s)
  // captions(root, { lines: [{ id: "h3", at: 4.2 }] }); // or at explicit scene times
});
```

- Reads word timings from `vo(id)` and throws if a line has none yet (generate the VO first).
- Sits in `layout().slot("caption")` (above the bottom 12% in 9:16). It splits text into chunks at sentence punctuation and at the measured line width, max 2 lines, and shrinks the type if a single word would leave the frame.
- The spoken word changes colour and grows slightly. Options: `preset` (`"short"` / `"long"`, chosen from the orientation by default), `fontFamily`, `fontSize`, `fontWeight`, `color`, `activeColor` (default `#ffd60a`), `background` (pill fill, e.g. `"#000000aa"`), `maxWords`, `hold`, `start`, `gap`, `name`.
- Keep other content out of the caption slot when captions are on.

### Source & Photo Credits (`credit`)

```ts
import { credit } from "liosvideo";

credit(root, { source: ["ANTARA", "CNBC Indonesia"], asset: "assets/images/habibie.jpg", lang: "id" });
// -> "Sumber: ANTARA • CNBC Indonesia • Foto: Kantor Wapres RI, domain publik"
```

- One line in a fixed spot that never meets the captions. In 16:9 and 1:1 it sits right-aligned in the bottom margin under the caption slot. In 9:16 it sits at the top-right of the safe area, because the bottom belongs to captions and the platform UI. Long credits shrink to fit, and a translucent backdrop keeps it readable (`background: false` turns the backdrop off).
- `asset` fills the photo credit and licence from that file's row in `assets/ATTRIBUTIONS.md`, so the screen always matches the attribution table. The table's headers can be English or Indonesian (File/Asset, Source/Sumber, Author/Creator, License/Lisensi), and a row may list just the file name. With no author column, the source site is credited. AI-generated rows render as "AI illustration (Google Gemini)" (`lang: "id"`: "Ilustrasi AI").
- Other options: `source`, `photo`, `license`, `text` (replaces the whole line), `lang` (`"en"` / `"id"`), `at` / `until` (fade in/out), `color`, `fontFamily`, `name`.

### Motion-synced SFX (`sfx` on moves)

Put whooshes, pops and hits on the move that makes them, not on a hand-kept timeline:

```ts
card.to({ x: 600 }, { at: 1.2, duration: 0.5, sfx: "whoosh" });                       // at the move's start
badge.to({ scaleX: 1, scaleY: 1 }, { at: 2, duration: 0.3, sfx: { name: "pop", on: "end", volume: 0.3 } });
three({ /* … */ cameraPath: orbit({ /* … */ start: 0, end: 3, sfx: "whoosh" }) });      // camera presets
cameraPath([{ at: 0, position: [0, 1, 6] }, { at: 2, position: [4, 1, 3], sfx: "whoosh" }, { at: 4, position: [4, 2, 0] }]); // leaving a key

export default composition({
  /* … */
  sfx: { volume: 0.5, library: { whoosh: "assets/audio/sfx/whoosh_fast.wav", pop: { src: "assets/audio/sfx/pop.wav", volume: 0.3 } } },
});
```

- A name is looked up in `sfx.library`, then used as a path if it has `/` or `.`, else `assets/audio/sfx/<name>.wav`. Level: the cue's `volume`, then the library entry's, then `sfx.volume`, then 0.5.
- Options: `on: "start" | "end"`, `volume`, `offset` (seconds; negative leads the move), `duration` (trims the sound, with a fade-out). Every SFX clip gets a short fade in and out so nothing clicks; they never duck the music.
- The composition adds them as `role: "sfx"` clips at scene start + move time; `composition({ sfx: false })` leaves them out. Any clip can fade too: `{ src, startAt, fadeIn: 0.5, fadeOut: 1 }`.

### Mix: Loudness & Ducking (automatic)

Every render (CLI and desktop export) runs the mix through a master bus:

- **Ducking**: music beds dip **-12 dB** under voice-over, ramping down 0.15 s before each line and back up 0.4 s after it. Lines closer than 0.55 s apart hold the dip, so the music doesn't pump between them. Clips in `assets/audio/vo/` (or with `role: "vo"`) count as voice-over. A clip ducks when it has `role: "music"` or `ducking: true`, or when it is 8 s or longer and is not SFX. SFX means `role: "sfx"`, or a file named `sfx` or kept in `sfx/`. Turn ducking off for a clip with `ducking: false`.
- **Loudness**: the whole programme is normalised to **-14 LUFS** integrated (BS.1770, YouTube/TikTok/Reels), then a look-ahead limiter keeps peaks under **-1 dBFS**. Write volumes for balance, not for level; there is no need to turn everything down "to be safe".
- Override it per composition: `composition({ ..., mix: { loudness: -16, duck: { amount: 9, attack: 0.2, release: 0.6 } } })`. Use `loudness: false` to keep the raw level and `duck: false` to turn off ducking. CLI: `liosvideo render long.ts --loudness -16` or `--no-normalize`. The render prints the measured and final LUFS.
- The desktop preview applies ducking live; loudness normalisation happens on export.

### Easing names

`linear`, `inQuad`, `outQuad`, `inOutQuad`, `inCubic`, `outCubic`, `inOutCubic` (default), `outBack`, `inExpo`, `outExpo`, `inOutExpo`, `inSine`, `outSine`, `inOutSine`, or a `(t) => number` curve. An unknown name throws where it is written, naming the node, property and `file:line`. Unknown `fit`, `align` and transition values do the same.

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

### Geometric Primitives & Media
- `circle({ radius: 50, fill: "#38bdf8" })`: Creates perfect circles for avatars, indicators, or floating particles.
- `path({ d: "M 0 0 L 100 0 L 50 86 Z", fill: "#f59e0b" })`: Vector SVG paths for triangles, stars, badges, and custom polygons. The node sizes itself to the path's bounds; use `fill: ""` with `stroke`/`strokeWidth` for outline-only shapes.
- `rect({ width, height, radius, fill, stroke })`: Basic rectangles with rounded borders.
- `image({ src: "assets/images/hero.png", width: 400, height: 300, fit: "contain" })`: External raster or SVG images.
- `video({ src: "assets/video/clip.mp4", width, height, fit: "cover", loop: true })`: Video footage rendered in real-time.

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
- `shadows: true`, `toneMapping: "aces" | "agx" | "neutral" | …`, `exposure`: renderer settings (there is no renderer in `setup`). Shadows still need `light.castShadow`, `mesh.castShadow` / `receiveShadow`. Off / `"none"` / `1` by default.
- The desktop preview renders with WebGL and the CLI with three.js on the GPU, so textures, shadows, tone mapping and emissive look the same in both. Set `camera.fov` / `aspect` changes with `camera.updateProjectionMatrix()`, as in plain three.js.

Bloom, depth of field and contact shadows look the same in the preview and the render:

```ts
import { contactShadow, three } from "liosvideo";

three({
  name: "hero", width, height, toneMapping: "aces",
  glow: 18, glowThreshold: 0.75, glowIntensity: 1.2,                   // bloom: only pixels brighter than the threshold glow
  depthOfField: { focus: [0, 0.5, 0], aperture: 0.1, samples: 16 },  // sharp at that point, softer nearer and further
  setup({ scene }) {
    const product = new THREE.Mesh(/* … */);
    scene.add(product);
    scene.updateMatrixWorld(true);
    scene.add(contactShadow(product, { opacity: 0.6 }).mesh);          // soft patch on the floor, darkest where it touches
  },
});
```

- Bloom is the `glow` filter with `glowThreshold` (0–1, any node); pair it with `emissiveIntensity` above 1 for lamps and screens.
- `depthOfField.focus` is a distance from the camera, a world point, or `(t) => …` for a rack focus; `aperture` is the lens radius in world units. Each frame renders `samples` times, so it costs that much render time.
- `contactShadow(object, { y, opacity, falloff, blur, resolution, color })` bakes from the object's triangles; call it after placing the object and add `.mesh` to the scene itself. Call `.update()` from `update` when the object moves.

Models, image textures and HDR environments load with `gltf`, `texture` and `hdr` from `liosvideo`, inside an `async setup` (the frame waits for it):

```ts
import { gltf, hdr, scene, texture, three } from "liosvideo";
import * as THREE from "three";

three({
  name: "product", width, height, toneMapping: "aces", shadows: true,
  async setup({ scene }) {
    const env = await hdr("assets/hdri/studio.hdr");        // equirect .hdr: reflections + lighting
    scene.environment = env;
    const mic = await gltf("assets/models/mic.glb");        // .glb / .gltf with its materials and textures
    scene.add(mic.scene);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ map: await texture("assets/images/wood.jpg", { repeat: [4, 4] }) }));
    scene.add(floor);
    return { grill: mic.part("grill") };                     // a named node; a typo throws with the names
  },
  update({ grill }, progress) { grill.rotation.y = progress * Math.PI; },
});
```

- Paths are project-relative (`assets/models/`, `assets/hdri/`, `assets/images/`); list each file in `assets/ATTRIBUTIONS.md` (Poly Haven and Sketchfab CC0/CC-BY are good sources).
- `texture(src, { colorSpace: "linear" })` for normal / roughness maps; colour maps are sRGB by default.
- Each `gltf()` call returns its own copy of the scene, so two uses animate separately. `model.animations` holds the clips.
- Not supported yet: Draco / meshopt compressed meshes and KTX2 textures. Export plain `.glb` (gltf-transform `--compress false`).

Camera moves are a `cameraPath` prop, not hand-written `update` maths, so the preview and the render take the same shot:

```ts
import { cameraPath, dolly, orbit, pushIn, three } from "liosvideo";

three({
  name: "hero", width, height, fov: 40,
  cameraPath: cameraPath([                                   // keys at scene seconds; catmull spline, inOutCubic per segment
    { at: 0, position: [-4, 1, 6], target: [0, 0.5, 0] },
    { at: 2, position: [0, 2, 3], target: [0, 0.5, 0], fov: 35 },
    { at: 4, position: [4, 1, 6], target: [0, 1, 0], fov: 28 },
  ], { ease: "inOutSine", spline: "catmull" }),             // spline: "linear" for straight legs
  setup({ scene }) { /* … */ },
});
// Presets (start / end in scene seconds; fov: number | [from, to]):
// orbit({ target: [0, 0, 0], radius: 6, height: 2, from: 0, to: Math.PI / 2, start: 0, end: 4 })
// dolly({ from: [-3, 1, 5], to: [3, 1, 5], target: [0, 0, 0], start: 0.5, end: 3 })
// pushIn({ from: [0, 1, 8], target: [0, 0.5, 0], amount: 0.4, start: 1, end: 3, fov: [40, 30] })
```

- The path moves the camera before your `update` runs; `update` gets the camera as `state.camera` when setup did not return one. Outside the keys the camera holds the first / last pose.
- `path.sample(t)` gives `{ position, target, fov }`; `path.apply(camera, t)` sets it by hand (e.g. two paths cut together in `update`).

Labels that point at parts of the model follow it with `callout` (the stage needs a `cameraPath`):

```ts
import { callout } from "liosvideo";

const stage = root.add(three({ name: "stage", width, height, fov: 35, cameraPath: orbit({ /* … */ }), setup }));
callout(stage, { target: [0.3, 2.4, 0.2], label: "Mesh grill", at: 3.4 });       // a world-space point on the part
callout(stage, { target: (t) => [Math.sin(t), 1, 0], label: "Rotor", offset: [-120, -60] }); // a part that moves
const p = stage.project([0, 1, 0], t);   // { x, y, depth, visible } in the stage's parent space, for your own overlays
```

- The dot, leader and label are added next to the stage and hide while the point is behind the camera. Options: `offset` (label position from the dot, px), `at` / `until`, `color`, `accent`, `fontFamily`, `fontSize`, `name`.
- Points are world coordinates (read them from your model in setup, or measure once); a part animated in `update` needs the same motion as `(t) => [x, y, z]`.
- `node.drive((t) => ({ x, y }))` sets any node's props from scene time, after its keyframes, for other things that follow a projected point.

Dust, sparks and embers come from `particles` (seeded: the same field in every render, any frame order):

```ts
import { particles, three } from "liosvideo";

three({
  name: "dust", width, height,
  setup({ scene, camera }) {
    const dust = particles({ count: 400, seed: 3, area: [6, 3, 4], velocity: [0, 0.12, 0], size: [0.02, 0.06], lifetime: 5, color: ["#ffd27a", "#fff1c1"] });
    scene.add(dust.object);
    return { dust, camera };
  },
  update({ dust, camera }, _progress, time) { dust.update(time, camera); },
});
```

- Glowing camera-facing discs with additive blending; they shrink with distance and fade in and out over `fade` (fraction of `lifetime`, default 0.25). `lit: true` makes them catch the scene's lights instead of glowing.
- Other options: `center`, `spread` (random speed), `gravity` (e.g. `[0, -9.8, 0]` for sparks), `turbulence`, `intensity`, `segments`. Call `particles()` inside `setup`.

Cutaways (section cuts) use three.js clipping planes on the material, in world space; move the plane in `update`:

```ts
setup({ scene }) {
  const cut = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 2);   // keeps x < 2 (normal · p + constant ≥ 0)
  const body = new THREE.MeshStandardMaterial({ color: "#c0c4cc", side: THREE.DoubleSide, clippingPlanes: [cut] });
  scene.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 48, 1, true), body));
  return { cut };
},
update({ cut }, progress) { cut.constant = 2 - 2 * progress; },  // slices to the middle
```

- `clipIntersection: true` cuts only where every plane cuts. `DoubleSide` shows the inner walls through the cut. Clip meshes: the software fallback does not clip lines or points.

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

### UI Mockups (browser, file explorer, chat, notification)

Built-in components for software demos. Give each a box from `layout()`; text, rows and bubbles scale with the box, and long text wraps or ends in "…" so nothing leaves it. `theme: "dark" | "light"`.

```ts
import { browserWindow, chatThread, fileExplorer, notification } from "liosvideo";

const b = root.add(browserWindow({ ...L.slot("center"), url: "about:blank", tabs: ["Home", "Docs"], content: [/* nodes on the page */] }));
b.typeUrl("https://example.com/pricing", { at: 0.6, duration: 1.2 });   // types into the address bar
b.switchTab(1, { at: 2.4 });

const files = root.add(fileExplorer({ ...box, title: "MY-APP", selected: "index.ts",
  items: [{ name: "src", children: ["index.ts", "app.ts"] }, { name: "assets", open: false, children: [] }, "package.json"] }));
files.select("app.ts", { at: 1.5 });                                     // moves the selection bar; a typo throws with the row names

const chat = root.add(chatThread({ ...box, title: "Assistant", reveal: { start: 0.4, gap: 1.2 }, typing: 0.8,
  messages: [{ from: "user", text: "Summarise this PR" }, { from: "assistant", text: "It adds…" }] }));
// chat.times[i] is when message i appears; typing dots show before each reply and the thread scrolls to the newest bubble

const card = phoneNode.contentArea.add(notification({ x: 12, y: 80, width: 360, app: "Mail", title: "New message", body: "…", time: "now" }));
card.show({ at: 0.5, hold: 2.5 });                                       // slides in, holds, fades out; variant: "desktop" slides from the right
```

See `examples/ui-mockups` in the liosvideo repository for all four in 16:9 and 9:16.

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
    const u = Math.min(width, height) / 100; // rhythm unit (≈11px at 1080p)
    const safe = u * 6;                      // outer margin on every edge

    // 1. Container Card
    const card = root.add(
      rect({
        name: "card",
        width: Math.min(width - safe * 2, u * 90),
        height: Math.min(height - safe * 2, u * 62),
        x: width / 2,
        y: height / 2,
        anchorX: 0.5,
        anchorY: 0.5,
        radius: u,
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
        y: card.height / 2 - u * 2,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 0
      })
    );

    title.to(
      { opacity: 1, y: card.height / 2 - u * 3 },
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

### Layout Grid

`layout({ width, height })` is the only way to position things. It returns a 12-column (16:9), 4-column (9:16) or 8-column (1:1) grid inside the safe area.

- **Pick a slot first.** `L.slot("title" | "center" | "body" | "left" | "right" | "lowerThird" | "caption" | "full")` returns a box plus the text `align` that suits it. `left`/`right` turn into top/bottom in 9:16 automatically. Combine `title` + one of (`body` | `left` and `right` | `center`) + `caption` — those never overlap. `full` and `lowerThird` sit over a full-frame image/video.
- **Stack inside it.** `stack(L.slot("body"), [heading, para, chip], { gap: L.gap(2) })` measures each child, wraps text to the slot width, aligns it, and returns one group to animate as a unit.
- **Off-slot pieces go on the grid.** `L.cell(colStart, colSpan, rowStart, rowSpan)` or `L.col(...)`/`L.row(...)`. Spans outside the grid throw — read the message and pick a valid span.
- **Type comes from the scale.** Spread `L.type.display | h1 | h2 | body | caption | label` into `text()`; never invent a `fontSize`.
- **Gaps come from the scale.** `L.gap(1 | 2 | 3 | 4 | 6 | 8)`.
- Non-text children of a `stack` need explicit `width`/`height`. Animate opacity/scale/blur on stacked children, and move the stack group rather than the children.

### Whitespace, Safe Areas & Spacing

Whitespace is the difference between a slide and a good video: fewer elements, bigger gaps, and edges that stay clear of platform UI.

```ts
const L = layout({ width, height }); // L.u = rhythm unit (≈11px at 1080p), L.safe = box inside the margins
```

1. **One rhythm.** Every gap and padding is `u * 1, 2, 3, 4, 6 or 8` — one step inside a group, two steps between groups. Never hand-pick 13 / 37 / 55 px.
2. **Safe area.** Nothing crosses `safe` on any edge. In 9:16 reserve `height * 0.12` at the bottom (platform UI, captions) and `height * 0.05` at the top (status bar).
3. **Proximity before separators.** Related items sit ≤ 1 step apart; unrelated blocks ≥ 2 steps. If two blocks still feel glued, separate them with weight, colour or a divider before adding space.
4. **Text air.** Headline `lineHeight` 1.1–1.2, body 1.4–1.5, caption 1.2. Heading → body is `u`; paragraph → paragraph is `u * 2`. Use `L.type.*` for sizes and let text wrap with `maxWidth` (or a `stack`) — lines stay ≤ 60 characters (≤ 32 in 9:16) without hand-inserted `\n`.
5. **Card padding.** Inner padding ≥ `u * 1.5`, `radius` = `u * 0.5–1`; text and icons never touch an edge.
6. **Fill 55–70%.** Content covers 55–70% of the frame; when it feels full, remove an element instead of shrinking the gaps.
7. **Exits leave no holes.** Entrances may start outside the safe area, but the resting layout stays balanced: fade or slide the whole group instead of leaving an empty slot.
8. **No progress bars.** Never draw a progress bar or timeline indicator, in 16:9 or 9:16: YouTube, TikTok, Reels, Shorts and Facebook all show their own. Don't carry one over from an older project's shell.

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

### Length Budget & Pacing

Total duration is just `Σ scene.duration` (`layoutComposition` adds scenes; transitions do not extend the timeline), so length is a decision, not a side effect of how many scenes you happened to write.

- **Pick the format and its target first.**

| Format | Target | Scenes |
| :--- | :--- | :--- |
| 9:16 hook / teaser | 10–20 s | 2–4 |
| 9:16 short / Reel / TikTok | 20–45 s (sweet spot 25–35 s) | 5–9 |
| 16:9 explainer / product | 2–5 min | 6–15 |
| Tutorial / walkthrough | 5–15 min | 15–40 |
| Documentation / course | **15–60 min** (30 min is normal) | 40–150 |

Long-form is a first-class target: a 30-minute documentation video is normal, so never stop at a 2–3 minute cut unless the user asked for a short.

- **Size the script.** Narration runs ~2.4 words/s (≈145 wpm): 30 s → 70–75 words in 5–7 lines; 5 min → ~720 words; 15 min → ~2,150 words; 30 min → ~4,300 words in 120–180 lines.
- **Derive scenes from narration.** `duration = Math.max(2.5, vo("id").duration + 0.6)` (0.4–0.8 s tail after the last word). Never cut a sentence to keep a scene short.
- **One beat per scene.** 2.5–8 s for short-form; 8–20 s for tutorials and docs when a diagram, code block or screen recording needs reading time. Something visible changes every 2–4 s (short) / 4–8 s (long-form).
- **Verify.** `liosvideo info <entry>` prints the total duration (`inspect_manifest` in the app). Compare with the target and add scenes/lines — never slow the motion down to pad time.

### Long-Form Structure (10–60 min)

A 30-minute video is ~54,000 frames at 30 fps. It is built as chapters, never as one giant scene or one giant file.

1. **One module per chapter.** `scenes/ch01-setup.ts`, `scenes/ch02-…`, each exporting its scenes; `long.ts` spreads them (`scenes: [...ch01, ...ch02, ...]`). Keep ids stable (`ch03-02-diagram`) so re-renders reuse caches.
2. **Chapter card.** Every chapter opens with a 2–4 s card: number, title, one-line goal, and optionally the chapter number as text (`3 / 12`) — never a progress bar.
3. **Beat sheet first.** 5–12 beats per chapter, each mapping to one `script.md` line and one scene. Build and preview chapter by chapter; don't write 30 minutes of scenes before the first render.
4. **Lower motion density.** Long-form holds shots: cuts, slow push-ins, highlights and typewriter lines, with `pop`/`shake`/zoom reserved for key moments.
5. **Reuse, don't copy.** Screen frames, code panes, callouts and caption styles live in helpers (`scenes/parts.ts`), not copy-pasted per scene.
6. **Audio.** One VO line per beat, a looped music bed at −18 to −24 dB, no sound effect on every beat.
7. **Render in ranges, then concat.** Render chapter ranges (`liosvideo render long.ts --frames 0..5400 -o out/ch01.mp4`) and join with `ffmpeg -f concat -safe 0 -i list.txt -c copy out/doc.mp4`. End chapters on a hard cut — transitions do not survive a concat. A full 30-minute render peaks at about 2 GB of RAM for the audio mixdown.
8. **Verify three frames.** First frame, a mid-chapter frame and the last frame (`liosvideo snapshot … --frame N`), plus `liosvideo info` for the total.

### Narration Workflow
1. Write the script in `script.md` using stable HTML comments:
   ```markdown
   <!-- vo:intro-line-1 -->
   Welcome to liosvideo, the next evolution in video creation.
   ```
   *Note: In the Liosvideo desktop workspace, switch to the **[ 📝 Script ]** tab to view your parsed voice lines, word count, and estimated duration.*
2. Generate narration audio:
   - Call `tts_generate` via MCP tool with `{ id: "intro-line-1", text: "..." }`.
   - Re-running is safe: unchanged lines (same text, voice, provider) reuse their files at no cost. After editing `script.md`, `liosvideo tts sync` regenerates only what changed (`--force` for everything).
   - The engine automatically saves `assets/audio/vo/intro-line-1.mp3` and records word-level timestamp alignments in `.liosvideo/project.json`.
3. In code:
   - Call `const line = vo("intro-line-1");`
   - `line.duration`: Exact line duration.
   - `line.wordTime("evolution")`: Precise second offset for on-beat animation triggers.

---

## 7. External Assets, Media Sourcing & Attributions

### When to Download External Assets
- When a video scene requires real-world footage, b-roll, photos, icons, custom fonts, sound effects, or brand logos that cannot be cleanly synthesized via vector shapes (`rect`, `circle`, `path`) or 3D meshes.
- Source high-quality, royalty-free, or permissively licensed media (Unsplash, Pexels, Wikimedia Commons, FreeSound, Google Fonts, GitHub raw assets).
- Store deterministic assets in standard project directories:
  - Images / logos: `assets/images/<filename>`
  - Video clips / b-roll: `assets/video/<filename>`
  - Fonts: `assets/fonts/<filename>`
  - Audio & SFX: `assets/audio/music/<filename>`

### Destockd (free archival B-roll)

`destockd_search` and `destockd_download` (CLI: `liosvideo asset search …` / `asset download …`) search
~41,000 public-domain or unrestricted US-government shots from the FedFlix archive with CLIP visual
search — describe what should be on screen, not keywords.

- Use it first for archival/historical B-roll. Hits carry `film`, `shot`, `clip` (MP4), `preview` and `keyframe`.
- `destockd_download` streams the clip into `assets/video/` and appends its `assets/ATTRIBUTIONS.md` row.
  Use the returned `relPath` in `video({ src })` and give the clip a clear `name`.
- Rights are **not** certified per clip: check the linked archive.org / NARA record before commercial use
  and keep the attribution row.
- Disturbing material (war/atrocity footage) is excluded by default; pass `include_disturbing: true` only
  when the brief needs it.

### Wikimedia Commons (photos with licences checked)

`commons_search` and `commons_download` (CLI: `liosvideo asset commons search "<query>"` /
`asset commons download "File:<name>"`) find photos and drawings of real people, places, products and
events, with each file's licence read from Commons.

- Hits carry `title`, `pageUrl`, `thumbUrl`, size, `author`, `licence` and `reusable`. Only CC0, public
  domain, CC BY and CC BY-SA are reusable; NC, ND, GFDL-only, fair use and unknown licences come back with
  `reusable: false` and a `refused` reason, and `commons_download` refuses them.
- `commons_download` saves into `assets/images/` (originals over 4096 px wide, and TIFFs, as a 3840 px
  thumbnail; `width` for a smaller one), writes the `assets/ATTRIBUTIONS.md` row (author and licence in
  plain text) and returns `relPath`, `credit` ("Photo: AndreX, CC BY-SA 4.0") and `descriptionCredit`
  (with the licence and file links, for the video description).
- Put `credit(root, { asset: relPath })` on screen while the photo shows; CC BY and CC BY-SA require it.

### Openverse (sound effects and music with licences checked)

`openverse_search` and `openverse_download` (CLI: `liosvideo asset audio search "<query>" --kind sfx|music` /
`asset audio download <id>`) find freely licensed audio on Openverse: sound effects from Freesound, music
from Jamendo and Wikimedia Commons audio.

- Search with specific words ("whoosh fast", "camera shutter", "calm piano"); anonymous use allows about 20
  searches a minute and 200 a day. `kind: "sfx"` searches Freesound, `"music"` Jamendo and Commons.
- Hits carry `id`, `title`, `creator`, `licence`, `durationSeconds`, `tags`, `pageUrl`, `previewUrl` and
  `reusable`. Only CC0, public domain, CC BY and CC BY-SA are reusable; NC, ND and Sampling+ come back with
  `reusable: false` and a `refused` reason, and `openverse_download` refuses them.
- `openverse_download` saves into `assets/audio/sfx/` or `assets/audio/music/` (`kind` to choose, `name` for
  the file name), writes the `assets/ATTRIBUTIONS.md` row and returns `relPath`, `usage`, `credit`
  ("Music: Torley on Piano, CC BY-SA 3.0") and `descriptionCredit`.
- A sound effect saved as `assets/audio/sfx/whoosh.mp3` plays with `sfx: "whoosh"` (the name finds the
  recorded file whatever its extension). Music goes in `composition({ audio: [{ src: relPath, role: "music", loop: true }] })`.
- CC BY and CC BY-SA need the credit: put `descriptionCredit` in the video description, and for music
  that runs under the whole video also `credit(root, { asset: relPath })` (or `asset: [photo, music]`
  to credit both in one line).

### earshot (sound effects made in code, optional)

When the [earshot](https://github.com/Leonxlnx/earshot) tool is installed
(`uv tool install "earshot @ git+https://github.com/Leonxlnx/earshot"`, needs ffmpeg),
`earshot_sfx_list` and `earshot_sfx_render` (CLI: `liosvideo asset sfx list --kind whoosh` /
`asset sfx render whoosh_fast/crisp --dur 0.8 --apex 0.32`) render its bank of about 250 sounds made in
code: whooshes, swishes, risers, hits, sub drops, clicks, taps, pops, dings, shutters, glitches and
mallet notes.

- Each render takes seconds, needs no network and lands in `assets/audio/sfx/<name>.wav`, so `sfx: "<name>"`
  plays it. Aim it at the move: `dur` (length), `apex` (when a whoosh peaks), `pitch` (a note for tonal
  sounds), `seed` (another take).
- The sounds are MIT and need no on-screen credit; the attribution row is written anyway.
- Without earshot the tools say how to install it; Openverse covers sound effects without it.

### AI Image Generation (Gemini / Nano Banana)

`image_generate` and `image_edit` (CLI: `liosvideo asset generate-image "<prompt>" --id <id>` / `asset edit-image <id> "<change>"`; desktop: **Images** tab) create images with Google Gemini. Needs `GEMINI_API_KEY` (`liosvideo key set GEMINI_API_KEY …` or desktop Settings).

- Images are generated **once** and saved as assets: `assets/images/<id>.png` is the active version, `assets/images/generated/<id>/v<n>.png` keeps every version. Scenes use `image({ src: "assets/images/<id>.png" })`; never call an API from scene code.
- Revise instead of re-prompting: `image_edit` with a short instruction ("darker sky", "remove the text", "fewer people") keeps the composition and adds a new active version at the same path, so no scene code changes. `liosvideo asset use-image <id> <n>` (or the Images tab) switches back to an earlier version.
- Pass `refs` (project image paths) to keep a character, product or style consistent across scenes. The aspect defaults to the project's (9:16 for short-only projects, else 16:9).
- Prompts: subject, setting, lighting, style, framing, and "no text" unless text is wanted; describe the look of the video (e.g. muted documentary colours, film grain).
- **Use it for** illustrations, backgrounds, concepts, diagrams-as-art and clearly labelled reconstructions. **Prefer real photos / archive footage** (Wikimedia, Destockd) for real people and events. Never generate a real person's face or a news event and present it as a real photo; label reconstructions on screen ("Ilustrasi" / "Illustration").
- Every image gets an `assets/ATTRIBUTIONS.md` row marked AI-generated with its prompt.

### Mandatory Asset Attribution (`assets/ATTRIBUTIONS.md`)
- Whenever you download or incorporate external assets, maintain an attribution record in `assets/ATTRIBUTIONS.md`:
  ```markdown
  # Project Asset Attributions

  | Asset | Source / URL | Author / Creator | License | Notes / Usage |
  | :--- | :--- | :--- | :--- | :--- |
  | `assets/video/skyline.mp4` | https://pexels.com/video/12345 | Jane Doe | Pexels License | Scene 1 Background |
  | `assets/images/logo.svg` | https://github.com/my-org/brand | MyOrg | MIT | Scene 2 Navbar |
  ```

### User Video Attachments & Chat Workflow
- The desktop app allows users to drag-and-drop, paste, or attach video files directly in the chat panel.
- To prevent prompt token overflow and ACP failures, videos are **never sent as binary/base64 in the LLM prompt**.
- Instead, the file is saved directly to `assets/video/<filename>` and the user prompt includes a notice:
  `[New video asset added: assets/video/<filename>. Use it in scene code with: video({ src: "assets/video/<filename>" })]`
- When receiving this notice, integrate the video in the scene using `video(...)`:
  ```ts
  import { scene, video } from "liosvideo";

  export default scene("showcase", { duration: 5 }, ({ root, width, height }) => {
    root.add(
      video({
        name: "hero-clip",
        src: "assets/video/skyline.mp4",
        width,
        height,
        fit: "cover", // "cover" | "contain" | "fill"
        startOffset: 0,
        loop: true
      })
    );
  });
  ```

---

## 8. MCP Editor Tools

When operating as an AI agent connected via ACP:
- `inspect_manifest`: Get overall project status, total duration, scenes, and audio tracks.
- `get_node_path`: Inspect hierarchy paths and computed positions of nodes on stage.
- `tts_list_voices`: Query available local and cloud TTS voices.
- `tts_generate`: Synthesize speech clips with automatic word alignment data.
- `capture_frame`: Capture a PNG snapshot at any timestamp for visual inspection.
- `image_generate` / `image_edit`: Generate an image with Gemini into `assets/images/<id>.png`, or revise it with a plain instruction (new version, same path).
- `validate_scene`: Validate scene TypeScript code against deterministic rendering rules, illegal imports, node naming constraints, and asset existence.

---

## 9. Verification & Visual Diffing

Before marking tasks complete:
1. **Layout Check**:
   - Verify coordinates with both landscape (16:9) and portrait (9:16) compositions.
   - Ensure texts have appropriate line wrapping and do not collide with edges.
2. **Visual Inspection**:
   - Compare rendered frames against reference design screenshots using the desktop preview's visual diff overlay (`blend` or `difference` mode).
3. **Audio-Visual Sync**:
   - Ensure key animation hits (`title.to`, punch-in zooms, keyword highlights) align accurately with `vo().wordTime()` timestamps.

---

## 10. Agent Troubleshooting & Authentication

When using the built-in Claude agent or ACP integration:
- **OAuth Session Expired**: If the chat interface reports an expired OAuth session or authentication failure, an interactive Action Card appears directly in the chat panel with one-click actions:
  - **Reconnect**: Attempts to refresh the current OAuth session.
  - **Login via Terminal**: Launches your system terminal (macOS Terminal, Windows CMD, or Linux terminal) running `claude login` to re-authenticate the Claude CLI directly.
  - **Set API Key**: Opens the Settings modal to supply a direct `ANTHROPIC_API_KEY` as fallback.

---

## 11. Visual Styles

When `.liosvideo/project.json` has a `"style"`, the project is committed to that look:

1. Read `.agents/skills/liosvideo/styles/<style>.md` first — Look, Palette, Motion, Helpers, Do / Don't.
2. Build every scene from `styles/<style>.ts`: `theme` for colours/fonts/easings, `look` spread on the art's group (filters), helpers for the style's signature shapes and moves.
3. Restyling an existing scene ("restyle this in the Comic Art style"): keep its content, timing and voice-over sync; replace colours, fonts, shapes and motion with the kit's; keep crisp text outside filtered groups.
4. Lay out for both 16:9 and 9:16 (`const portrait = height > width`), and verify with `capture_frame` at both ratios.
5. 3D styles (`ps2-lowpoly`, `cgi-motion`, `brick`, `explainer-3d`, `product-studio`) use `three()`; draw all randomness in the scene builder with `random()`, never in `setup`/`update`.
