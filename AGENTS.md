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

Each scene is a self-contained module whose default export is a `scene(id, config, builder)`. A project helper that returns one also works (`export default docScene({ id: "hook", … })` with `docScene` in `lib/`); `validate_scene` follows the import to check it:

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
| **Text** | `text(props)` | Group properties plus `text, fontFamily, fontSize, fontWeight, color, lineHeight, align ("left" \| "center" \| "right"), maxWidth` (wraps words past `maxWidth`) |
| **Image** | `image(props)` | Group properties plus `src` (project-relative path), `fit ("fill" \| "contain" \| "cover")` |
| **Video** | `video(props)` | Group properties plus `src` (project-relative path, e.g. `"assets/video/clip.mp4"`), `fit ("fill" \| "contain" \| "cover")`, `startOffset`, `speed`, `loop` |
| **Three (3D)** | `three(props)` | Group properties plus `camera ("perspective" \| "orthographic"), fov, shadows, toneMapping, exposure, setup({ scene, camera, width, height }), update(state, progress, time)` (Three.js 3D scenes, meshes, lights, materials) |
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

Renderer settings are props, since `setup` gets no renderer:

- `shadows: true`, `toneMapping: "aces" | "agx" | "neutral" | …`, `exposure`: renderer settings (there is no renderer in `setup`). Shadows still need `light.castShadow`, `mesh.castShadow` / `receiveShadow`. Off / `"none"` / `1` by default.
- The desktop preview renders with WebGL and the CLI with three.js on the GPU, so textures, shadows, tone mapping and emissive look the same in both. Set `camera.fov` / `aspect` changes with `camera.updateProjectionMatrix()`, as in plain three.js.

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

## Layout Grid (use it for every placement)

Never hand-compute pixel positions. `layout({ width, height })` gives the same, correct layout in 16:9, 9:16 and 1:1:

```ts
import { layout, rect, scene, stack, text } from "liosvideo";

export default scene("point", { duration: 5 }, ({ root, width, height }) => {
  const L = layout({ width, height });

  // Named slot + stack: positions, gaps, wrapping and alignment are decided for you
  const title = text({ name: "title", text: "Ship faster with fewer meetings", ...L.type.h1, color: "#fff" });
  const body = text({ name: "body", text: "Async updates replace the daily stand-up.", ...L.type.body, color: "#9aa4b2" });
  root.add(stack(L.slot("title"), [title, body], { name: "heading", gap: L.gap(2) }));

  // Grid cells for anything else (columns are 1-based: 12 in 16:9, 4 in 9:16, 8 in 1:1)
  const card = L.cell(7, 6, 3, 4);
  root.add(rect({ name: "card", ...card, radius: L.u, fill: "#161b22" }));

  title.to({ opacity: 1 }, { at: 0.2, duration: 0.4 });
});
```

| API | Gives |
| :--- | :--- |
| `L.u`, `L.safe`, `L.gutter` | Rhythm unit, content box inside the safe area, column/row gutter |
| `L.col(start, span)` / `L.row(start, span)` / `L.cell(c, cs, r, rs)` | `{x, width}` / `{y, height}` / a box on the grid; out-of-grid spans throw |
| `L.gap(n)` | `u * n`, only for n = 1, 2, 3, 4, 6, 8 |
| `L.slot(name)` | Box + `align` for `full`, `title`, `center`, `body`, `left`, `right`, `lowerThird`, `caption`; `left`/`right` become top/bottom in 9:16. `title` + one of (`body` \| `left`+`right` \| `center`) + `caption` never overlap; `full` and `lowerThird` overlay a full-frame visual |
| `L.type.display / h1 / h2 / body / caption / label` | `{ fontSize, lineHeight, fontWeight }` — spread into `text()` |
| `stack(box, children, { gap, direction?, align?, justify?, name? })` | A group at the box holding the children laid out in a column (default) or row; text in a column wraps to the box width and takes its alignment |

- `text` wraps by width with `maxWidth` and aligns lines with `align: "left" | "center" | "right"`; inside `stack` both are set for you.
- Sizes are read when the scene is built, so give non-text children (rects, images, groups) an explicit `width`/`height`.
- Animate `opacity`, `scaleX/Y`, `blur` on stacked children freely. Animating their `x`/`y` replaces the stacked position — slide the whole stack group instead.
- Style kits keep their colours and fonts; take positions and sizes from `layout()`.

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
- `"inExpo"`, `"outExpo"`, `"inOutExpo"`
- `"inSine"`, `"outSine"`, `"inOutSine"`
- Custom curve: `(t: number) => number`

An unknown name throws where it is written, with the node, the property and `file:line`, e.g. `Unknown ease "inOutBounce" on node "title" (opacity) (scenes/hook.ts:42). Use one of: …`. The same goes for `fit`, `align`, transition names and directions. `validate_scene` reports unknown `ease`, `fit` and transition names without running the scene.

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
   - Unchanged lines are free: a line whose text, voice and provider match the last run reuses its files (`cached: true`, no provider call). `liosvideo tts sync` generates only the changed lines of `script.md`; pass `force: true` / `--force` to regenerate anyway.
3. **In-App Voice Recording**:
   - Voice lines recorded directly in the app are automatically saved and transcribed with timestamps.
4. **Timing Sync with `vo(id)`**:
   - `vo(id).duration`: Exact audio duration in seconds.
   - `vo(id).wordTime(word)`: Second offset when a specific word is spoken.

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

### Mix: Loudness & Ducking (automatic)

Every render (CLI and desktop export) runs the mix through a master bus:

- **Ducking**: music beds dip **-12 dB** under voice-over, ramping down 0.15 s before each line and back up 0.4 s after it. Lines closer than 0.55 s apart hold the dip, so the music doesn't pump between them. Clips in `assets/audio/vo/` (or with `role: "vo"`) count as voice-over. A clip ducks when it has `role: "music"` or `ducking: true`, or when it is 8 s or longer and is not SFX. SFX means `role: "sfx"`, or a file named `sfx` or kept in `sfx/`. Turn ducking off for a clip with `ducking: false`.
- **Loudness**: the whole programme is normalised to **-14 LUFS** integrated (BS.1770, YouTube/TikTok/Reels), then a look-ahead limiter keeps peaks under **-1 dBFS**. Write volumes for balance, not for level; there is no need to turn everything down "to be safe".
- Override it per composition: `composition({ ..., mix: { loudness: -16, duck: { amount: 9, attack: 0.2, release: 0.6 } } })`. Use `loudness: false` to keep the raw level and `duck: false` to turn off ducking. CLI: `liosvideo render long.ts --loudness -16` or `--no-normalize`. The render prints the measured and final LUFS.
- The desktop preview applies ducking live; loudness normalisation happens on export.

---

## External Assets, Media & Attributions

### When to Download External Assets
- When a video scene requires real-world footage, b-roll, photos, icons, custom fonts, sound effects, or brand logos that cannot be cleanly synthesized via vector shapes (`rect`, `circle`, `path`) or 3D meshes.
- Source high-quality, royalty-free, or permissively licensed media (Unsplash, Pexels, Wikimedia Commons, FreeSound, Google Fonts, GitHub raw assets).
- For archival/historical B-roll use Destockd first: `destockd_search` then `destockd_download` (CLI: `liosvideo asset search …` / `asset download …`). It downloads FedFlix/government footage into `assets/video/` and appends the attribution row. Rights are not certified per clip — check the source record before commercial use, and keep the row in `assets/ATTRIBUTIONS.md`.
- For photos of real people, places, products and events use Wikimedia Commons: `commons_search` then `commons_download` (CLI: `liosvideo asset commons search …` / `asset commons download "File:…"`). Only CC0, public domain, CC BY and CC BY-SA files download (NC, ND, GFDL-only and fair use are refused with the reason). It saves into `assets/images/`, writes the attribution row, and returns `credit` — show it with `credit(root, { asset: relPath })` — plus `descriptionCredit` for the video description.
- Store deterministic assets in standard directories:
  - Images / logos: `assets/images/<filename>`
  - Video clips / b-roll: `assets/video/<filename>`
  - Fonts: `assets/fonts/<filename>`
  - Audio & SFX: `assets/audio/music/<filename>`

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
        src: "assets/video/filename.mp4",
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

## Editor MCP Server Tools

When interacting as an AI agent via ACP (Claude Code, Gemini CLI, Codex), use the built-in Editor MCP tools:

- `inspect_manifest`: Read current composition duration, scene list, and audio tracks.
- `get_node_path`: Resolve element hierarchy and bounding boxes for targeted edits.
- `tts_list_voices`: List available local and cloud narration voices.
- `tts_generate`: Synthesize speech with word-level timestamps.
- `capture_frame`: Capture a PNG frame at timestamp `t` for visual verification.
- `image_generate` / `image_edit`: Generate an image with Gemini into `assets/images/<id>.png`, or revise it with a plain instruction (new version, same path). See *AI Image Generation*.
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
   - Only import `liosvideo`, `three` and relative project files.
   - Do not import other npm packages or use Node.js standard libraries.
3. **Naming Consistency**:
   - Always give meaningful `name` attributes to nodes (`card`, `title`, `badge`, `avatar`).
   - Do not use `/` inside node names; path segments use `/` as delimiters.
4. **Targeted Revisions**:
   - When the user selects a node or timestamp range in the timeline, edit only the affected scene and elements.
   - Keep unchanged scenes intact to preserve render cache.
5. **Git Commit Co-Author Attribution**:
   - Always include the AI assistant as a co-author trailer in git commit messages:
     ```
     Co-authored-by: Antigravity <antigravity@deepmind.google>
     ```
     (or matching the active agent: `Co-authored-by: Claude <noreply@anthropic.com>`, etc.).
6. **Whitespace & Safe Areas**:
   - Rhythm unit `u = Math.min(width, height) / 100`; every gap and padding is `u * [1, 2, 3, 4, 6, 8]`.
   - Keep content at least `u * 6` from every edge; in 9:16 keep `height * 0.12` clear at the bottom (platform UI) and `height * 0.05` at the top.
   - Place everything with `layout()` (slots, `L.cell`, `stack`) and size text with `L.type.*` — see *Layout Grid*. Give long text `maxWidth` (or put it in a `stack`) instead of hand-inserting `\n`.
   - Headline `lineHeight` 1.1–1.2, body 1.4–1.5. See the director skill's *Whitespace, Safe Areas & Spacing*.
   - No progress bars or timeline indicators, in any format: YouTube, TikTok, Reels, Shorts and Facebook all draw their own scrubber. A chapter number as text (`3 / 12`) is fine.
7. **Length & Pacing**:
   - Total duration is `Σ scene.duration`; plan it first: 9:16 shorts 20–45 s (5–9 scenes), 16:9 explainers 2–5 min, tutorials 5–15 min, documentation/courses **15–60 min** (40–150 scenes).
   - Long-form is built in chapters: one module per chapter, 5–12 beats each, rendered in ranges (`--frames`) and concatenated.
   - Script ≈ 2.4 words/s (30 s ≈ 75 words, 30 min ≈ 4,300 words); narrated scenes take their duration from `scene(id, { vo: [...] })`, minimum 2.5 s.
   - The scaffold's 3 s `intro.ts` and 3-line `script.md` are placeholders — expand to the target and verify with `liosvideo info`.
