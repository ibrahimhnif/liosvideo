# CLI ↔ Desktop parity

The standalone `liosvideo` CLI (`apps/cli`) now ships the same rendering engine and the same
backend feature set as the desktop app, with no Node.js, Chromium, or FFmpeg dependency.

## What is identical

| Area | Notes |
| :--- | :--- |
| Scene evaluation | Same `@liosvideo/runtime` bundle, same `evaluateFrame` output, same deterministic seeded random. |
| Transitions / keyframes / z-sorting | Evaluated inside V8, identical render lists. |
| Rect / circle | Same SDF quad shader, rounded corners and inside stroke. |
| Text | Same layout rules (hard `\n` breaks, `fontSize * lineHeight`, per-line vertical centring, left aligned). Metrics come from cosmic-text instead of Canvas2D, so glyph widths can differ slightly. |
| Image / SVG | `image` + `resvg` decode, premultiplied upload, identical `fill`/`contain`/`cover` math. |
| Video | MP4/H.264 decoded frame-accurately at `VideoItem.time` (desktop currently shows frame 0 only). |
| Layers | Same recursive layer targets, opacity, gaussian blur (`sigma = blur*sx/2`, radius ≤ 64) and rounded-rect clip with identical inverse-matrix uniforms. |
| Colour pipeline | `rgba8unorm`, premultiplied alpha, no sRGB linearisation — matching the desktop renderer byte-for-byte. |
| Shaders | `common.wgsl`, `quad.wgsl`, `blur.wgsl`, `composite.wgsl` are copied from `packages/runtime` and guarded by a unit test. |
| Custom WGSL (`shader()`) | Both compile and run `code` for real with the same preamble, bindings and uniform contract. |
| three.js (`three()`) | Both execute `setup` / `update`. Desktop uses WebGL when available and the same deterministic software rasteriser as the CLI otherwise. |
| Audio mixdown | Manifest audio clips: `startFrame`, `startOffset`, `duration`, `volume`; no looping, no ducking (same as desktop `audio_mixdown.ts`). |
| Export | H.264 + AAC in MP4, presets `native | 1080p | 4k | shorts`, 10/30 Mbps defaults, 192 kbps AAC, 2-second keyframe interval. |
| Validation | Same text-based scene validator (`scene_validator.rs`). |
| History | Same git2 implementation (`checkpoint`, `log`, `diff`, `restore`, `revert-files`). |
| Scaffolding | Same templates (`blank`, `minimal-dev`, `product-3d`, `kinetic-short`, `saas-launch`). |
| TTS | Same providers and word-level timing files (ElevenLabs, Google Cloud TTS, mock). |
| Secrets | Same keychain chain: env → macOS Keychain → `~/.config/liosvideo/credentials.json`. |
| ACP agents | Same registry, adapter install, session lifecycle, git checkpoints per turn. |
| MCP | Same 11 tools over stdio/TCP; render tools now run server-side. |
| Watch | Same 100 ms debounced watcher; prints changes (and can run a command). |

## Known deltas

1. **Text metrics** — cosmic-text instead of Canvas2D, so text boxes may be a few pixels wider/narrower.
2. **`path` nodes** — still drawn as a solid quad in both renderers (the desktop never tessellates `d`).
3. **Custom WGSL** — identical on both. The shader preamble exposes
   `u_globals.time` (`x` = seconds, `y` = progress), `u_globals.resolution`, and
   `u.<key>` (`vec4f` per `uniforms` entry). User code must define
   `@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f` and must not declare its own
   `@group` / `@binding`.
4. **three.js fidelity** — the CLI always uses the deterministic software rasteriser; the desktop
   prefers WebGL (textures, shadows, skinning, morph targets, instancing, post-processing and
   custom `ShaderMaterial` work there) and falls back to the software rasteriser when WebGL is
   unavailable, e.g. a WKWebView worker. The software rasteriser supports Mesh / Line / LineSegments /
   LineLoop / Points, BufferGeometry (indexed or not, groups, multi-material), MeshBasic / Lambert /
   Phong / Standard / Toon / Normal materials, Ambient / Hemisphere / Directional / Point / Spot
   lights, vertex colours, flat shading, side modes and transparency. Not supported by the
   software path: textures, shadows, skinning, morph targets, instancing, post-processing and
   custom `ShaderMaterial`.
5. **Video codecs** — MP4/H.264 only. WebM/VP9 falls back to the first frame with a warning.
6. **GUI-only features** — timeline selection, preview playback, visual diff overlays and chat UI
   have no CLI equivalent; their stateful MCP siblings (`set_selection`, `seek`) are kept in memory.
7. **Duplicated backend code** — `apps/cli/src/{project,tts,agents,acp,mcp}` are copies of the
   desktop modules with Tauri removed. Run `scripts/check-sync.sh` to see drift.
8. **Agent permissions** — CLI sessions auto-approve tool permissions (no interactive UI).

## Command map

| Desktop action | CLI |
| :--- | :--- |
| Export video | `liosvideo render <entry> [-o out.mp4] [--preset …]` |
| Capture frame | `liosvideo snapshot <entry> --frame N` |
| Inspector / timeline | `liosvideo info <entry> --json` |
| Scene validation | `liosvideo validate [path] [--json]` |
| History | `liosvideo history status|enable|log|diff|checkpoint|restore|revert-files` |
| New project | `liosvideo project new <parent> <name> --template …` |
| Recent projects | `liosvideo project recent` |
| Stats / conversation | `liosvideo project stats`, `liosvideo project token-usage`, `liosvideo project conversation get|set` |
| TTS | `liosvideo tts voices|generate|timings` |
| Asset import | `liosvideo asset import <id> <file>`, `save-image`, `save-video`, `record-voice` |
| API keys | `liosvideo key get|set|delete <service>` |
| ACP agent | `liosvideo agent list|prompt|chat|auth|set-config|install-adapter|…` |
| MCP server | `liosvideo mcp serve [--stdio|--tcp addr]`, `mcp tools`, `mcp call <tool>` |
| File watcher | `liosvideo watch [--exec <command>]` |

All project-scoped commands accept `--project <dir>` (defaults to the current directory).
