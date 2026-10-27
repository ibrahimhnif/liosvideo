# liosvideo — Design

Date: 2026-10-27
Status: draft for review

## 1. Intent

A personal desktop app for making technical explainer videos by talking to an AI coding agent. The user describes a video ("I want to make a video about php2shell"). The agent researches the topic, writes the script, builds a timeline, asks the user for any assets it needs, and writes every scene as code: motion graphics, shaders, animated text, realistic desktop/app mockups, transitions. The user watches a live preview, selects a scene or object on the timeline, and asks for targeted revisions in chat. Every change is tracked in git inside the project folder, so anything can be diffed or rolled back.

**Why code-driven:** an LLM is much better at writing and revising code than at operating a GUI editor. Code also gives exact, repeatable output and real diffs and history.

**Target output:**
- Long-form YouTube video, 16:9, in a style like the NesiNowhere channel: tech explainers with desktop/terminal/browser walkthroughs, code on screen, narration.
- Short-form vertical video, 9:16, for TikTok, Instagram Reels and YouTube Shorts.

## 2. Goals

1. Chat-first workflow: one prompt to a researched script, a timeline and a first rendered draft.
2. Works with **any ACP agent the user already has installed**, with one-click setup.
3. Live, scrubbable preview that hot-reloads when the agent edits scene code.
4. Scenes are **object hierarchies** (scene graphs) with animatable, nested objects and per-object effects.
5. Mockups of desktop, browser, terminal and editor that **look exactly like real screenshots**.
6. Narration-driven timing. TTS by default (Google TTS, ElevenLabs), plus in-app voice recording.
7. Timeline selection becomes targeted revision context for the agent.
8. A single self-contained, git-tracked project folder per topic, with multiple output formats per folder.
9. Hardware-accelerated MP4 export.
10. Extensible through MCP servers passed to the agent.

## 3. Non-goals (v1)

- Collaboration, cloud sync, accounts, hosted rendering.
- A manual drag-and-drop editor. The timeline is for navigating, selecting and inspecting; edits go through chat or by hand-editing code. (Builder's call whether simple trim handles come later.)
- Installing agents themselves. The app installs only ACP adapters.
- Generating music or SFX in-app. These are user-supplied assets, or come from user MCP servers.
- Windows/Linux in v1. **macOS first** (the user's platform). Avoid gratuitous mac-only choices where cheap, except mockup rendering, which is intentionally macOS-styled.

## 4. Anti-goals (failure even if it "works")

- Mockups that look drawn, cartoonish or "almost" real. The bar is indistinguishable from a real screenshot at 1080p.
- Preview and export disagreeing. The same frame number must produce the same pixels.
- A revision to one scene silently changing other scenes.
- Losing work. Every agent change must be recoverable through git.
- Generated scene code being able to touch the file system or network.

## 5. Stack (decided by the user)

- **Tauri 2** (Rust backend) + **Svelte 5** frontend (TypeScript).
- **WebGPU** for rendering, **WebCodecs** for encode/decode.
- **ACP (Agent Client Protocol)** for the agent connection. **MCP** for tools.
- **Git** for project history.

## 6. UI

Two panes.

**Left: chat.**
- Message bubbles: user, agent, and agent status/tool activity (collapsible: "reading scenes/intro.ts", "generating voice line 4"). Agent thoughts and plans are shown when the ACP agent streams them.
- Interactive cards in the stream:
  - **Asset request:** description of what's needed + file picker / drag-drop + "skip". The agent turn waits for the answer.
  - **Permission requests** from the agent (ACP `session/request_permission`): allow once / always / deny.
  - **Voice line:** play, regenerate, record-your-own.
- A **selection chip** above the input shows the current timeline selection (e.g. `long.ts › scene "install-extension" › Terminal`). It is attached to the next message as context. Clearable.
- Agent picker + status (connected / working / error), and a cancel button for the current turn.

**Right: preview + timeline.**
- Composition switcher (`long.ts`, `short.ts`, …) above the preview. The preview uses the composition's aspect ratio.
- Transport: play/pause, frame step, current time/frame, loop range.
- Timeline:
  - Scene track: blocks per scene, labelled, in order.
  - Audio track(s): narration clips (with waveform), music.
  - Expanding a scene shows its **object tree** (Desktop › Chrome › URL bar …) with each object's animation spans.
  - Clicking a scene or object selects it (feeds the chat selection chip) and seeks the playhead to it.
- History panel (could be a tab): list of commits (agent turns), with diff view and "restore to here".
- Export button: choose composition, resolution and fps, then a progress bar.

**First-run / settings:**
- Agent setup screen (see §8).
- TTS provider keys (stored in the macOS keychain), default voice.
- Project open/create (recent projects list).

## 7. Project folder

One topic = one folder. Each output format is its own entry file.

```
php2shell/
  long.ts                ← composition: 16:9, fps, scene order, audio
  short.ts               ← composition: 9:16
  scenes/                ← scene modules, importable by any composition
    intro.ts
    install-extension.ts
  script.md              ← researched script, narration lines with stable ids
  assets/
    images/ video/ fonts/
    audio/
      vo/                ← narration clips (generated or recorded) + timing JSON
      music/
  .liosvideo/
    project.json         ← project settings (TTS provider/voice, defaults)
    cache/               ← gitignored: TTS cache, thumbnails, compiled bundles
  out/                   ← gitignored: exported MP4s
  .gitignore
  .git/
  AGENTS.md              ← instructions for the agent: runtime API, conventions, tools
```

- **Any `*.ts` file at the project root that default-exports a composition is renderable.** New formats (teaser, square) are just new files.
- **Code is the source of truth.** The timeline is derived by evaluating the composition (see §9.4). It is not a separate hand-edited JSON that can drift. *(Decision: the user's original ask mentioned "timeline JSON". A generated `timeline.json` manifest is fine as a cache/debug artifact, but it is never edited.)*
- `AGENTS.md` (plus `CLAUDE.md`/`GEMINI.md` symlinks or copies, builder's call) is written on project creation. It teaches any agent the runtime API and conventions, independently of which agent is used.
- Large binary assets: plain git in v1. Git LFS is a later option, builder's call.

## 8. Agent integration (ACP)

### 8.1 Detection and one-click setup

On launch (and on demand from settings), the Rust side scans for known agents: PATH plus common install locations (`~/.local/bin`, `~/.npm-global`, Homebrew, `~/.bun/bin`, nvm shims…). Note that GUI apps on macOS don't inherit the shell PATH, so resolve the login shell's PATH.

Maintain a **built-in registry** (data file, easy to update) of known agents, each with:
- detection: binary name(s), version command
- ACP launch: either a native ACP mode (command + args), or an adapter package and how to install it (e.g. an npm package run via `npx`/installed globally)
- auth notes

Initial entries (verify current command names/packages at build time, since these move fast): Claude Code (via its ACP adapter), Gemini CLI (native ACP mode), Codex (via its ACP adapter), OpenCode, Goose, plus any other agent listed in the public ACP agent registry, if one is usable.

States shown per agent:
- **Ready**: ACP available.
- **Enable**: agent installed, adapter missing. One click installs the adapter, showing streamed progress and errors.
- **Not installed**: greyed out with an install link. The app does not install agents.

Plus **"Add custom agent"**: name + command + args + env, for any ACP agent.

The user picks a default agent. It can be switched per project.

**Auth:** the agent uses its own existing login/subscription. The app never sees agent credentials. If the agent reports it needs auth (ACP auth methods), surface that with instructions or a button that triggers the agent's auth flow.

### 8.2 Session

- The Rust backend spawns the agent process and speaks ACP (JSON-RPC over stdio). Use the official Rust ACP crate if suitable. The frontend talks to Rust through Tauri commands/events.
- One ACP session per project. `cwd` = project folder.
- On `session/new`, pass MCP servers: **the app's own editor MCP server** (§8.3) + the user's configured MCP servers.
- The app implements ACP client capabilities: file read/write (scoped to the project folder), terminal (if the agent requests it), permission requests → chat cards.
- Streamed updates (message chunks, tool calls, plans) → chat UI.
- Load/resume sessions if the agent supports it. Otherwise new session per app launch, with `AGENTS.md` + git log as continuity.

### 8.3 Editor MCP server (built in)

Exposed to the agent so it can drive the editor. Transport is the builder's call (stdio sidecar binary or local HTTP). Tools:

| Tool | Purpose |
|---|---|
| `get_project_state` | compositions, scenes, current selection, playhead, last compile/runtime errors |
| `get_timeline(composition)` | evaluated timeline: scenes, start/end, object trees, audio clips |
| `render_frame(composition, time)` | returns a PNG of a frame, so the agent can *see* its work |
| `render_contact_sheet(composition, scene?)` | grid of N frames across a range |
| `request_asset(id, kind, description)` | shows the asset card in chat, blocks until the user provides or skips; returns the stored path |
| `tts_generate(line_id, text, voice?)` | generates narration via the configured provider; writes clip + word timings |
| `tts_list_voices(provider)` | |
| `set_selection` / `seek` | lets the agent point the user at something |
| `checkpoint(message)` | forces a git commit with a message |

Compile/type errors and runtime exceptions from scene code are always available through `get_project_state` and also pushed into the next agent prompt context.

### 8.4 Targeted revisions

When the user sends a message with a selection chip, the prompt sent to the agent includes a structured context block: composition file, scene id, scene source file path, object path in the tree (e.g. `desktop/chrome/urlbar`), time range, current playhead time, and optionally a rendered frame of the playhead. The agent is instructed (in `AGENTS.md`) to confine edits to the selected scope unless asked otherwise.

### 8.5 Research

Topic research uses the agent's own tools (web search/fetch). The app provides none. The agent writes the result into `script.md`.

## 9. Scene runtime

### 9.1 Authoring model

A TypeScript library shipped with the app (the "runtime"). The agent writes scenes and compositions against it. Rough shape (API details are the builder's call):

```ts
// long.ts
import { composition } from "liosvideo";
import intro from "./scenes/intro";
import install from "./scenes/install-extension";

export default composition({
  width: 1920, height: 1080, fps: 30,
  scenes: [intro, install],          // sequential; per-scene duration or narration-driven
  narration: "script.md",
});
```

```ts
// scenes/install-extension.ts
import { scene, desktop, chrome, terminal, cursor, focus } from "liosvideo";

export default scene("install-extension", ({ at, vo }) => {
  const d = desktop({ wallpaper: "assets/images/wall.jpg" });
  const web = d.add(chrome({ url: "", title: "New Tab" }));
  const term = d.add(terminal({ cwd: "~/projects" }));

  at(vo("line-12").word("Chrome"), () => focus(web, { duration: 0.6 }));
  at(vo("line-12").word("store"),  () => web.urlbar.type("chromewebstore.google.com"));
  at(vo("line-13").start,          () => focus(term, { duration: 0.6 }));
  at(vo("line-13").word("install"),() => term.type("npm install -g foo"));
});
```

Key properties:
- **Deterministic.** Rendering is a pure function of (composition, frame). No `Date.now`, no unseeded randomness (provide a seeded RNG), no frame-to-frame state. Seeking to any frame directly gives the same pixels as playing up to it. This is what makes scrub, `render_frame` and export agree.
- **Scene graph.** Nodes with parent/child transforms (position, scale, rotation, anchor), opacity, z-order, clipping (incl. rounded rects), and per-node effects: blur, shadow, dim, color adjust, custom shader. Moving a parent moves its children.
- **Animation.** Keyframes and tweens on any property, easing library, springs, and timing anchored to narration (`vo(lineId).start/end/word(...)`) or absolute times.
- **Primitives:** text (rich, animated reveals: per-char/word/line), shapes, paths, images, video clips (decoded with WebCodecs, frame-accurate), code blocks (syntax highlighting, line highlight/focus, typing), diagrams/arrows, transitions between scenes (cut, fade, slide, zoom, shader transitions).
- **Escape hatch:** a raw WGSL shader node/pass for custom effects, with uniforms for time, resolution and node inputs.
- **High-level helpers** like `focus(node)`. One call does the "bring to front, sharp, slide up; push others back, down, blurred, dimmed" swap the user described, in both directions.

### 9.2 Realistic mockups (hard requirement)

Built-in components that must look **identical to real screenshots** at 1080p and 4K:
- `desktop`: macOS wallpaper, menu bar (translucent/vibrancy blur), dock (optional), window shadows.
- `chrome`: real tab shape, tab strip, omnibox with typing, favicon, page content slot (image, video, screen recording, or runtime-drawn content).
- `terminal`: macOS Terminal and/or iTerm-style themes, real prompt, ANSI colors, blinking cursor, natural typing rhythm (seeded jitter), scrolling output.
- `editor`: VS Code-style window with syntax highlighting, line numbers, cursor/selection.
- `cursor`: macOS pointer with movement paths and click feedback.
- `phone`: device frame for 9:16 content.

**Where window content comes from (user decision):** the user supplies screenshots and screen recordings of real pages and apps, either when the agent asks for them through asset-request cards or by dropping them into `assets/` unprompted. For each one, the agent decides whether to:
- **use it directly** as the content of a mockup window, with pan, zoom, crop, highlight, and click/scroll animation over it, or
- **replicate it in code:** rebuild the page or app view as scene-graph nodes, using the screenshot as the visual reference (and `render_frame` to compare). This allows real interaction, like typing into a field, hovering or expanding a menu, at the cost of the fidelity bar.

The agent edits these choices freely like any other code. A useful runtime feature: a reference-overlay/diff mode that lays the source screenshot over a replicated view, so the agent and the user can check how close it is. Terminal output is scripted text (no live command capture in v1). The app does no web capture in v1. Headless page capture via MCP is a possible later addition.

Fidelity approach:
- Use the real system fonts (SF Pro, SF Mono, Menlo) with correct sizing, tracking and grayscale antialiasing. Text is rasterized at output resolution (e.g. Canvas2D/OffscreenCanvas into textures composited by WebGPU, builder's call), never scaled up from a smaller raster.
- Window chrome geometry, colors, corner radii and shadow parameters are measured from real screenshots on current macOS. Light and dark appearance both supported.
- **Golden-image tests:** each mockup is rendered and compared against reference screenshots of the real app at matching size and content (perceptual diff with a threshold). This is the acceptance gate for mockups.
- Real screenshots/recordings can be placed inside mockup windows as content.

### 9.3 Sandboxing and hot reload

- Project TS is bundled (esbuild-wasm in the frontend, or swc/esbuild on the Rust side, builder's call) with `liosvideo` resolved to the runtime.
- Scene code runs in a **Web Worker** with no access to Tauri APIs, file system or network. Assets are provided by the host through the runtime's asset loader only, scoped to the project folder. The worker renders via OffscreenCanvas + WebGPU.
- Rust watches the project folder (`notify`). On change: rebuild → swap the module in the worker → re-evaluate timeline → re-render the current frame. The playhead is preserved. Target: revision visible in ≤2 s after the agent writes the file.
- Compile errors and runtime exceptions show as an overlay on the preview, and are reported to the agent (§8.3).

### 9.4 Timeline derivation

Evaluating a composition yields a manifest: scenes (id, source file, start/end frames), object trees per scene (stable node ids/paths, with names the agent chose), animation spans per node, audio clips with start/end and word timings. The timeline UI renders this manifest. Node ids must be stable across re-evaluation so selections survive edits.

## 10. Audio

- **Narration source:** `script.md` contains narration lines with stable ids. Each line maps to a clip in `assets/audio/vo/<line-id>.<ext>` + `<line-id>.timing.json` (word-level start/end).
- **Providers:** Google Cloud TTS and ElevenLabs, built in. Per-project provider + voice in `project.json`. Use provider word/character timestamps where available. Otherwise run forced alignment (builder's call on tool).
- **Recording:** in-app mic recording per line (select line → record → review → keep). Recorded takes replace TTS clips and get timing via alignment.
- **Import:** drop in an audio file for a line.
- **Narration drives timing:** scene durations can be "fit to narration", and animations anchor to words. Regenerating or re-recording a line re-times dependent scenes automatically.
- **Cache:** TTS keyed by (provider, voice, settings, text). Unchanged lines are not regenerated.
- **Music/SFX:** user-supplied assets on audio tracks with volume and ducking under narration.
- **Preview audio:** Web Audio, sample-accurate sync to the playhead.
- **Keys:** TTS API keys live in the macOS keychain, never in the project or git.

## 11. Export

- Render each frame at full output resolution through the same runtime path as preview (offline, faster or slower than real time).
- Encode video with WebCodecs `VideoEncoder` (H.264, hardware). Mix the audio graph offline and encode AAC. Mux to MP4 (e.g. a JS MP4 muxer, builder's call). Output to `out/<composition>-<timestamp>.mp4`.
- Presets: 1080p30 (default), 1080p60, 4K30/60. 9:16 at 1080×1920.
- Platform-safe settings: yuv420p, faststart, bitrate suitable for YouTube/TikTok/Reels.
- **Fallback:** if WebCodecs AAC encoding or some codec path is unavailable in the macOS WebView, encode/mux on the Rust side (AVFoundation or bundled ffmpeg, builder's call). See §13 risks.
- Progress, cancel, and "open in Finder" when done.

## 12. Git history

- `git init` + `.gitignore` on project creation, initial commit.
- **Auto-commit at the end of every agent turn that changed files.** The message is a summary of the user prompt (+ the agent's summary if available). Also on asset upload, recording, and manual "checkpoint".
- History panel: list of commits, per-commit diff (code diffs; asset changes shown by name/thumbnail).
- **Restore:** "restore to here" creates a new commit that restores that tree. History is never rewritten, so a restore is itself undoable.
- Detect manual edits made outside the app (watcher + `git status`) and commit them as "manual edit" before the next agent turn, so agent changes stay isolated.
- Implementation via `git2` (libgit2) or the git CLI, builder's call.

## 13. Risks and early spikes

These should be proven in phase 0, before building on top of them:
1. **WebGPU + WebCodecs inside Tauri's macOS WKWebView.** Confirm WebGPU in workers with OffscreenCanvas, `VideoEncoder` H.264, `VideoDecoder` for video assets, and `AudioEncoder` AAC are available in the system WebView on the user's macOS. If any piece is missing, decide the fallback (Rust-side encode, etc.) before building the pipeline.
2. **Mockup fidelity.** Build the terminal + chrome window early and run the golden-image comparison. This is the hardest quality bar.
3. **ACP adapters.** Verify the current launch/adapter commands for Claude Code, Gemini CLI and Codex, and that passing an MCP server through `session/new` works with each.
4. **Export performance** at 4K: offline render + encode throughput.

## 14. Suggested phases

0. Spikes (§13).
1. **Runtime + preview:** scene graph, animation, text, shapes, deterministic seek, preview pane with transport, hot reload, error overlay. Hand-written sample project.
2. **Mockups:** desktop, chrome, terminal, editor, cursor, `focus()`. Golden-image tests.
3. **Timeline:** manifest derivation, scene/audio/object tracks, selection, seek.
4. **Project + git:** create/open project, scaffold (`AGENTS.md`, `.gitignore`), auto-commit, history panel, restore.
5. **ACP:** agent detection/registry, one-click adapter setup, session, chat UI, permissions, editor MCP server, selection context, asset request cards.
6. **Audio:** TTS providers, timing, narration-anchored animation, recording, music/ducking, preview audio.
7. **Export:** offline render, encode, mux, presets.
8. Polish: shader transitions, more primitives, Shorts-specific helpers (reframing a long scene to 9:16).

## 15. Calls made by the designer (not discussed with the user, open to override)

- **Target platform:** macOS 26+ on Apple Silicon (the user's machine runs a newer macOS). WebGPU in WKWebView is assumed available there. If WebGPU **inside a worker** fails the spike, render on the main thread inside an isolated, capability-less iframe/context instead (keeps the sandbox property). If WebGPU is unavailable entirely, stop and bring it back to the user before choosing between Rust-side `wgpu` and another engine.
- **Scope enforcement for revisions:** detect and warn, don't block. After each turn, the app compares changed files against the selection's scene file (+ composition). Out-of-scope changes show a warning in chat listing the files, with one-click "revert those files". Shared helper files are flagged too, but not auto-reverted.
- **Mockup look:** match the current macOS appearance (Liquid Glass) and current stable Chrome, Terminal.app, iTerm2 and VS Code at build time. Reference screenshots are captured by the user on their Retina Mac using a helper script/checklist the builder provides. The perceptual-diff threshold is tuned during phase 2 against human side-by-side judgement.
- **Narration with multiple compositions:** `script.md` has one section per composition (`## long`, `## short`). Line ids are global, so a composition can reuse another's line by id (`vo("long/line-12")`). Clips are named by line id. Before any narration exists, scenes use explicit durations.
- **Agent safety boundary:** best-effort. The app's ACP file access is scoped to the project folder, and the agent's own permission prompts are surfaced in chat (§6). No OS-level sandboxing of the agent process in v1.

## 16. Left to the builder

API naming and exact signatures, bundler choice, MCP transport, git library, MP4 muxer, alignment tool, internal state management in Svelte, exact registry entries (verify at build time), test framework, and visual styling of the app UI (clean, dark, editor-like by default).

## 17. Reference

- Style reference: youtube.com/@NesiNowhere. Study it for pacing, typography, and how desktop/terminal/code walkthroughs are shown.
