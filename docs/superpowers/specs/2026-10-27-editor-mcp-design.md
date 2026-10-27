# Editor MCP Server — Design Spec

**Date:** 2026-10-27  
**Status:** Draft / Proposed  
**Author:** Antigravity & User  
**Parent Spec:** `docs/superpowers/specs/2026-10-27-liosvideo-design.md` (§8.3)

---

## 1. Intent & Purpose

Enable ACP-connected AI coding agents (such as Command Code, Claude Code, and Gemini CLI) to inspect and drive the liosvideo editor during authoring turns. By exposing editor tools through the Model Context Protocol (MCP), the agent can:
- Query project state, active selections, playhead position, and compilation/runtime diagnostics.
- Inspect the evaluated timeline hierarchy (scenes, objects, audio tracks).
- Capture rendered frames (`render_frame`, `render_contact_sheet`) to visually verify visual changes.
- Request missing media assets from the user via interactive cards in the chat UI.
- Direct user focus by adjusting selections and moving the playhead.
- Create explicit git checkpoints during multi-step revisions.

---

## 2. Architecture & Transport

### 2.1 The Challenge
ACP specifies that clients pass `mcpServers` during `session/new`:
```json
{
  "name": "liosvideo",
  "command": "/path/to/binary",
  "args": ["--stdio"],
  "env": {}
}
```
ACP agents expect an executable command communicating via `stdio`. However, all editor state (webview DOM, timeline manifest, playhead, active project) lives inside the running Tauri desktop application process.

### 2.2 Solution: Internal Server + CLI Stdio Bridge
1. **In-Process MCP Core (Tauri Desktop App):**
   - When the desktop app starts or a project is open, it binds a local loopback TCP listener on an ephemeral port (`127.0.0.1:<port>`) or a Unix domain socket on macOS/Linux (`/tmp/liosvideo-<pid>.sock`).
   - The server handles MCP JSON-RPC requests (`initialize`, `tools/list`, `tools/call`).
2. **CLI Stdio Bridge (`--mcp-bridge`):**
   - The desktop binary itself (`std::env::current_exe()`) supports a lightweight subcommand:
     `desktop --mcp-bridge <port_or_socket_path>`
   - When invoked by the ACP agent, it forwards stdin bytes to the local socket and socket responses to stdout. It has near-zero overhead and terminates when the agent closes stdin.
3. **Session Handshake (`Session::open_session`):**
   - When starting an ACP session, `Session` provides:
     ```json
     {
       "mcpServers": [
         {
           "name": "liosvideo",
           "command": "<current_exe_path>",
           "args": ["--mcp-bridge", "<port_or_socket_path>"]
         }
       ]
     }
     ```

---

## 3. Tool Declarations & Schemas

The MCP server responds to `tools/list` with the following 8 tools:

### 3.1 `get_project_state`
Returns editor context including compositions, selection, errors, and transport state.
- **Input Schema:** `{}` (no required parameters).
- **Returns:**
  ```json
  {
    "projectName": "php2shell-sample",
    "projectRoot": "/path/to/project",
    "compositions": ["Main"],
    "activeComposition": "Main",
    "scenes": ["intro", "terminal", "editor", "outro"],
    "activeScene": "terminal",
    "selection": {
      "sceneId": "terminal",
      "objectPath": "desktop/terminal/cursor"
    },
    "playhead": {
      "frame": 120,
      "fps": 60,
      "timeSeconds": 2.0
    },
    "errors": {
      "compile": [],
      "runtime": []
    }
  }
  ```

### 3.2 `get_timeline`
Returns the evaluated timeline structure.
- **Input Schema:**
  - `composition` *(optional string)*: Composition name (defaults to active composition).
- **Returns:**
  ```json
  {
    "durationFrames": 900,
    "fps": 60,
    "scenes": [
      {
        "id": "terminal",
        "name": "Terminal Demo",
        "file": "scenes/terminal.ts",
        "startFrame": 0,
        "durationFrames": 300,
        "objectTree": [
          { "id": "window", "kind": "window", "children": ["prompt", "cursor"] }
        ]
      }
    ],
    "audioTracks": []
  }
  ```

### 3.3 `render_frame`
Renders a single frame and returns image data so the agent can "see" its changes.
- **Input Schema:**
  - `frame` *(optional integer)*: Frame index (defaults to current playhead frame).
  - `timeSeconds` *(optional number)*: Alternative to frame number.
  - `composition` *(optional string)*: Composition name.
- **Returns:** MCP image content block:
  ```json
  {
    "content": [
      {
        "type": "image",
        "data": "<base64_encoded_png>",
        "mimeType": "image/png"
      },
      {
        "type": "text",
        "text": "Frame 120 (2.00 s)"
      }
    ]
  }
  ```

### 3.4 `render_contact_sheet`
Renders a sequence or grid of frames across a scene to verify movement and transitions.
- **Input Schema:**
  - `sceneId` *(optional string)*: Scene identifier (defaults to active scene).
  - `count` *(optional integer, default: 4, max: 8)*: Number of evenly spaced frames.
- **Returns:** An array of image blocks with corresponding frame stamps.

### 3.5 `request_asset`
Requests a file/asset from the user when the agent cannot generate it (e.g. logos, recordings, fonts).
- **Input Schema:**
  - `id` *(string)*: Unique asset identifier (e.g. `"app-logo"`).
  - `kind` *(string)*: `"image" | "audio" | "video" | "font"`.
  - `description` *(string)*: Clear instruction for the user (e.g. `"SVG or transparent PNG of the product logo"`).
- **Behavior:**
  - Emits an `agent://asset_request` event to the desktop frontend.
  - Displays an interactive `AssetCard` in the chat feed with a file drop/picker and a "Skip" option.
  - Blocks the MCP tool call until the user provides the file or skips.
  - Upon file selection, copies the file into `assets/<id>.<ext>` in the project folder and returns `{ "path": "assets/app-logo.png", "status": "provided" }`.
  - If skipped, returns `{ "path": null, "status": "skipped" }`.

### 3.6 `set_selection`
Directs the editor UI and timeline selection.
- **Input Schema:**
  - `sceneId` *(optional string)*
  - `objectPath` *(optional string)*
- **Returns:** `{ "status": "ok", "selection": { ... } }`

### 3.7 `seek`
Moves the transport playhead.
- **Input Schema:**
  - `frame` *(optional integer)*
  - `timeSeconds` *(optional number)*
- **Returns:** `{ "status": "ok", "frame": 180 }`

### 3.8 `checkpoint`
Forces an immediate git commit.
- **Input Schema:**
  - `message` *(string)*: Commit summary description.
- **Returns:** `{ "commitSha": "abc1234", "summary": "message" }`

---

## 4. Bridge to Frontend & Runtime

1. **State Store (`EditorState` in Rust):**
   - Tracks active project, selection, latest compile/runtime diagnostics reported by preview host, and playhead position.
2. **Webview IPC for Frame Capture (`render_frame`):**
   - The webview sandbox already renders using Canvas / WebGL in `Preview.svelte`.
   - Tauri emits an internal query `editor://capture_frame` with `{ frame }`.
   - The preview host renders that frame offscreen or in the canvas, extracts base64 PNG via `canvas.toDataURL("image/png")`, and replies via Tauri invoke `report_captured_frame`.
   - Uses a `oneshot` channel with a 5-second timeout.
3. **Asset Request Coordination:**
   - Pending asset requests are registered in a `Arc<Mutex<HashMap<String, oneshot::Sender<AssetResult>>>>`.
   - The user's action in the UI invokes Tauri command `resolve_asset_request(id, path_or_skip)`.

---

## 5. Error Handling & Safety Boundaries

- **Timeout Safety:** Any tool requiring webview response (`render_frame`, `get_timeline`) enforces a 5 s timeout to prevent agent hangs if the preview is compiling or crashed.
- **Asset Request Cancellation:** If an agent turn ends or is cancelled while an asset request is pending, the request is automatically marked cancelled and the UI card is disabled.
- **Path Sanitization:** File copies from `request_asset` are strictly contained within the project's `assets/` directory using `project::resolve_in_project`.
- **Port Allocation:** Ephemeral port `127.0.0.1:0` prevents port conflicts across multiple running instances.

---

## 6. Implementation Phases

1. **Phase 1: MCP Core & Stdio Bridge**
   - Rust MCP protocol handler (`initialize`, `tools/list`, `tools/call` routing).
   - `--mcp-bridge` CLI handler in `main.rs`.
   - Pass MCP server config to `Session::open_session`.
2. **Phase 2: Project State, Selection, Seek & Checkpoint**
   - Implement `get_project_state`, `set_selection`, `seek`, `checkpoint`.
   - Link with `Project` and `git` module.
3. **Phase 3: Timeline & Frame Capture**
   - Webview frame capture API in `Preview.svelte` / `host.ts`.
   - Implement `render_frame` and `render_contact_sheet`.
4. **Phase 4: Asset Request Card**
   - Svelte component `AssetCard.svelte` in `ChatPane`.
   - Implement `request_asset` tool with async user response handling.
