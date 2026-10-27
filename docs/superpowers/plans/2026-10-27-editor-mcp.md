# Editor MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a built-in Model Context Protocol (MCP) server for liosvideo so ACP agents (Command Code, Claude Code, Gemini CLI) can inspect project state and timeline, capture rendered frames, adjust selection/playhead, create git checkpoints, and request assets via interactive chat cards.

**Architecture:** An in-process MCP server in the Tauri desktop application listens on an ephemeral loopback TCP port (`127.0.0.1:0`). A lightweight CLI subcommand (`desktop --mcp-bridge <port>`) bridges stdin/stdout to this TCP port. When starting an ACP session (`session/new`), the app dynamically passes this bridge as an MCP server. Tool requests for frame capture or UI updates communicate with the frontend webview via Tauri events and IPC.

**Tech Stack:** Rust (Tauri 2, Tokio with `net` feature, `serde`, `serde_json`, `git2`), Svelte 5 (`ChatPane`, `AssetCard`), Vitest & Cargo test.

**Spec:** `docs/superpowers/specs/2026-10-27-editor-mcp-design.md`

## Global Constraints

- Handshake protocol: JSON-RPC 2.0 (newline-delimited over stream).
- MCP specification compliance for `tools/list` and `tools/call`.
- Frame rendering timeout: 5 seconds max (never hang an agent if webview crashes).
- Strict path sandboxing: all asset files written to `assets/` validated via `project::resolve_in_project`.
- Ephemeral port: `127.0.0.1:0` to guarantee no port conflicts.

---

### Task 1: MCP Core Protocol & Tool Registry

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/mcp/protocol.rs`
- Create: `apps/desktop/src-tauri/src/mcp/tools.rs`
- Create: `apps/desktop/src-tauri/src/mcp/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `mcp::protocol::handle_mcp_message(registry: &ToolRegistry, raw: &str) -> Option<String>`
  - `mcp::tools::ToolRegistry`: registers and dispatches `Tool` implementations.
  - `mcp::tools::Tool`: trait with `name(&self) -> &'static str`, `description(&self) -> &'static str`, `input_schema(&self) -> serde_json::Value`, `call(&self, args: Value) -> Pin<Box<dyn Future<Output = Result<Value, String>> + Send>>`.

- [ ] **Step 1: Enable `tokio/net` feature in `Cargo.toml`**

Add `"net"` to tokio features in `apps/desktop/src-tauri/Cargo.toml`:
```toml
tokio = { version = "1.54.1", features = ["process", "io-util", "sync", "macros", "rt-multi-thread", "time", "net"] }
```

- [ ] **Step 2: Write failing unit tests for MCP protocol handling**

Create `apps/desktop/src-tauri/src/mcp/protocol.rs` tests:
- `initialize` returns protocol version `2024-11-05` and server info `{"name": "liosvideo", "version": "0.1.0"}`.
- `notifications/initialized` returns `None` (notifications receive no response).
- `tools/list` returns all registered tools with schemas.
- `tools/call` for an unknown tool returns error code `-32601` ("Method not found").
- `tools/call` for a known tool invokes handler and returns `{ "content": [...] }`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::protocol`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `protocol.rs`, `tools.rs`, and `mod.rs`**

Implement JSON-RPC 2.0 message parsing, serialization, and tool registry dispatch. Export `pub mod mcp;` in `lib.rs`.

- [ ] **Step 5: Run tests and verify they pass**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::protocol`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/mcp apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(mcp): core json-rpc protocol parser and tool registry"
```

---

### Task 2: In-Process TCP Listener & `--mcp-bridge` CLI

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp/server.rs`
- Create: `apps/desktop/src-tauri/src/mcp/bridge.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Modify: `apps/desktop/src-tauri/src/mcp/mod.rs`

**Interfaces:**
- Produces:
  - `mcp::server::McpServer::bind(registry: Arc<ToolRegistry>) -> Result<McpServer, std::io::Error>`
  - `server.port() -> u16`
  - `server.stop()`
  - `mcp::bridge::run_bridge(port: u16) -> Result<(), Box<dyn std::error::Error>>`

- [ ] **Step 1: Write failing test for TCP server and bridge**

Create `apps/desktop/src-tauri/src/mcp/server.rs` test:
- Start `McpServer::bind` on port 0.
- Connect a `TcpStream` client, send `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n`.
- Read response line, verify `id: 1` and server info.

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::server`
Expected: FAIL.

- [ ] **Step 3: Implement `server.rs` and `bridge.rs`**

- `server.rs`: Accepts connections on `127.0.0.1:0`. Uses `tokio::io::BufReader` with `read_line` to handle newline-delimited JSON-RPC, dispatches to `handle_mcp_message`, writes response with trailing `\n`.
- `bridge.rs`: Connects `tokio::io::stdin()` and `stdout()` to `tokio::net::TcpStream::connect("127.0.0.1:<port>")`.
- `main.rs`: Check `std::env::args()` before starting Tauri app; if `args[1] == "--mcp-bridge"`, parse port from `args[2]` and invoke `run_bridge(port)` directly, then exit `0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/server.rs apps/desktop/src-tauri/src/mcp/bridge.rs apps/desktop/src-tauri/src/mcp/mod.rs apps/desktop/src-tauri/src/main.rs
git commit -m "feat(mcp): in-process tcp server and cli stdio bridge"
```

---

### Task 3: ACP Handshake Integration

**Files:**
- Modify: `apps/desktop/src-tauri/src/acp/session.rs`
- Modify: `apps/desktop/src-tauri/src/acp/commands.rs`

**Interfaces:**
- Consumes: `McpServer` from Task 2.
- Produces: `Session::connect` receives an optional `mcp_port: Option<u16>` and injects `{ "name": "liosvideo", "command": current_exe, "args": ["--mcp-bridge", port.to_string()] }` into `client.new_session(&self.root, mcp_servers)`.

- [ ] **Step 1: Write failing test in `session.rs`**

Add test `session_passes_editor_mcp_server_to_new_session`:
- Spawn mock agent receiving `session/new`.
- Verify `m["params"]["mcpServers"][0]["name"] == "liosvideo"` and `args` contains `--mcp-bridge`.

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml acp::session::tests::session_passes_editor_mcp_server`
Expected: FAIL.

- [ ] **Step 3: Update `Session` and `commands.rs`**

- Update `Session::open_session` to pass the configured `mcpServers` list when an MCP server is active.
- Ensure fallback to `vec![]` if no server is running (e.g. headless tests).

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml acp::session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/acp/session.rs apps/desktop/src-tauri/src/acp/commands.rs
git commit -m "feat(acp): inject editor mcp server into session handshake"
```

---

### Task 4: State, Selection, Seek & Checkpoint Tools

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp/state_tools.rs`
- Modify: `apps/desktop/src-tauri/src/mcp/tools.rs`
- Modify: `apps/desktop/src-tauri/src/project.rs`

**Interfaces:**
- Produces:
  - `get_project_state` tool: reads active project compositions, current selection, playhead, errors.
  - `set_selection` tool: updates `Selection` in `Project` and emits `project://selection`.
  - `seek` tool: emits `preview://seek` event with `{ frame, timeSeconds }`.
  - `checkpoint` tool: runs `git::commit_all(&root, message)`.

- [ ] **Step 1: Write failing tests for state tools**

In `apps/desktop/src-tauri/src/mcp/state_tools.rs`:
- Test `get_project_state` returns valid JSON structure with root, compositions, selection.
- Test `set_selection` updates selection and records event.
- Test `seek` emits seek event with expected frame.
- Test `checkpoint` performs a git commit and returns the commit hash.

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::state_tools`
Expected: FAIL.

- [ ] **Step 3: Implement state tools**

Register the 4 tools in `ToolRegistry` and hook them up with the active `Project` context.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::state_tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/state_tools.rs apps/desktop/src-tauri/src/mcp/tools.rs apps/desktop/src-tauri/src/project.rs
git commit -m "feat(mcp): state, selection, seek, and checkpoint tools"
```

---

### Task 5: Webview Frame Capture & Timeline Tools

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp/render_tools.rs`
- Modify: `apps/desktop/src-tauri/src/mcp/tools.rs`
- Modify: `apps/desktop/src/lib/components/Preview.svelte`
- Modify: `apps/desktop/src/lib/preview/host.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `render_frame` tool: requests frame from webview, receives base64 PNG, returns MCP image content block.
  - `render_contact_sheet` tool: requests N frames and returns array of image blocks.
  - `get_timeline` tool: returns evaluated composition timeline manifest.

- [ ] **Step 1: Write failing Rust unit tests for render tools**

In `apps/desktop/src-tauri/src/mcp/render_tools.rs`:
- Mock webview capture responder.
- Test `render_frame` returns `{ "type": "image", "data": "...", "mimeType": "image/png" }`.
- Test `render_frame` times out cleanly after 5 seconds if webview doesn't reply.

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::render_tools`
Expected: FAIL.

- [ ] **Step 3: Implement frontend frame capture and backend coordination**

- In `Preview.svelte` & `host.ts`: Listen for `editor://capture_frame`, capture canvas image data via `canvas.toDataURL("image/png")`, invoke Tauri `report_captured_frame({ id, data })`.
- In Rust: Implement `render_tools.rs` with `tokio::sync::oneshot` and timeout.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::render_tools`
Run: `pnpm --filter desktop test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/render_tools.rs apps/desktop/src/lib/components/Preview.svelte apps/desktop/src/lib/preview/host.ts apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(mcp): webview frame capture and timeline inspection tools"
```

---

### Task 6: Asset Request Card & Interactive Response

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp/asset_tools.rs`
- Create: `apps/desktop/src/lib/components/AssetCard.svelte`
- Modify: `apps/desktop/src/lib/components/ChatPane.svelte`
- Modify: `apps/desktop/src/lib/chat/api.ts`
- Modify: `apps/desktop/src/lib/chat/reduce.ts`

**Interfaces:**
- Produces:
  - `request_asset` tool in `asset_tools.rs`.
  - `AssetCard.svelte` UI component.
  - Tauri command `resolve_asset_request(id: String, file_path: Option<String>)`.

- [ ] **Step 1: Write failing tests for AssetCard and asset tool**

- `reduce.test.ts`: Test `asset_request` event adds an asset item to chat; `asset_resolved` marks it answered.
- Rust test `request_asset_resolves_when_user_provides_file`: Test `request_asset` blocks until resolved, copies file to `assets/`, returns path.
- Rust test `request_asset_cancels_on_turn_end`: Unanswered requests cancel on turn end.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::asset_tools`
Run: `pnpm --filter desktop test`
Expected: FAIL.

- [ ] **Step 3: Implement `AssetCard.svelte` and `asset_tools.rs`**

- `AssetCard.svelte`: Displays asset id, description, file drop zone / "Choose File" button, and "Skip" button.
- `asset_tools.rs`: Manages pending requests map, copies chosen file to `assets/<id>.<ext>` using `project::resolve_in_project`, returns relative path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mcp::asset_tools`
Run: `pnpm --filter desktop test`
Run: `pnpm --filter desktop check`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp/asset_tools.rs apps/desktop/src/lib/components/AssetCard.svelte apps/desktop/src/lib/components/ChatPane.svelte apps/desktop/src/lib/chat
git commit -m "feat(mcp): asset request card and interactive upload handling"
```
