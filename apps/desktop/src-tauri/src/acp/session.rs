use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::oneshot;

use super::client::{AcpClient, ClientEvents, ClientHandler, SessionError};
use super::rpc::{BoxFuture, Connection};
use crate::git::{self, CommitInfo};
use crate::project::{git_job, ProjectError};

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SelectionContext {
    pub composition: String,
    pub scene_id: String,
    pub scene_file: Option<String>,
    pub path: Option<String>,
    pub start_frame: u32,
    pub end_frame: u32,
    pub fps: f64,
    pub playhead_frame: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub data: String,
    #[serde(alias = "mime_type")]
    pub mime_type: String,
    #[serde(alias = "rel_path")]
    pub rel_path: Option<String>,
}

/// The user's text, plus the timeline selection as a plain-text block and any attached image blocks.
pub fn build_prompt(
    text: &str,
    sel: Option<&SelectionContext>,
    images: Option<&[ImageInput]>,
) -> Vec<Value> {
    let mut full_text = text.to_string();
    if let Some(imgs) = images {
        let paths: Vec<String> = imgs.iter().filter_map(|img| img.rel_path.clone()).collect();
        if !paths.is_empty() {
            full_text.push_str(&format!(
                "\n\n[Attached image assets saved in project: {} (can be imported in scenes via image({{ src: \"...\", ... }}))]",
                paths.join(", ")
            ));
        }
    }

    let mut blocks = vec![json!({"type": "text", "text": full_text})];

    if let Some(imgs) = images {
        for img in imgs {
            blocks.push(json!({
                "type": "image",
                "data": img.data,
                "mimeType": img.mime_type,
            }));
        }
    }

    if let Some(sel) = sel {
        let secs = |f: u32| f as f64 / sel.fps;
        let mut lines = vec![
            "Selected on the timeline (confine edits to this unless asked otherwise):".to_string(),
            format!("composition: {}", sel.composition),
            match &sel.scene_file {
                Some(file) => format!("scene: {} (file: {file})", sel.scene_id),
                None => format!("scene: {}", sel.scene_id),
            },
        ];
        if let Some(path) = &sel.path {
            let rel = path.strip_prefix(&format!("{}/", sel.scene_id)).unwrap_or(path);
            lines.push(format!("object: {rel}"));
        }
        lines.push(format!("time: {:.2}s–{:.2}s (frames {}–{})", secs(sel.start_frame), secs(sel.end_frame), sel.start_frame, sel.end_frame));
        if let Some(f) = sel.playhead_frame {
            lines.push(format!("playhead: {:.2}s (frame {f})", secs(f)));
        }
        blocks.push(json!({"type": "text", "text": lines.join("\n")}));
    }
    blocks
}

/// First non-empty line of the prompt, whitespace collapsed, at most 72 characters.
pub fn turn_commit_message(prompt: &str) -> String {
    let Some(line) = prompt.lines().map(str::trim).find(|l| !l.is_empty()) else { return "Agent turn".into() };
    let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= 72 {
        return line;
    }
    let mut cut: String = line.chars().take(71).collect();
    cut.push('…');
    cut
}

/// Where session events go: Tauri's `app.emit` in the app, a recorder in tests.
pub trait SessionEvents: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: Value);
}

type Waiters = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// Bridges agent requests to the UI: updates are emitted, permission prompts wait for `respond`.
struct Bridge {
    events: Arc<dyn SessionEvents>,
    waiters: Waiters,
    next: AtomicU64,
    auto_approve: Arc<AtomicBool>,
}

impl ClientEvents for Bridge {
    fn update(&self, update: Value) {
        self.events.emit("agent://update", json!({ "update": update }));
    }

    fn permission(&self, params: Value) -> BoxFuture<Value> {
        if self.auto_approve.load(Ordering::Relaxed) {
            let allow_option_id = params["options"].as_array().and_then(|opts| {
                opts.iter()
                    .find(|o| o["kind"].as_str().is_some_and(|k| k.starts_with("allow")))
                    .or_else(|| opts.first())
                    .and_then(|o| o["optionId"].as_str().map(str::to_string))
            });
            if let Some(option_id) = allow_option_id {
                let id = format!("perm-{}", self.next.fetch_add(1, Ordering::Relaxed));
                self.events.emit(
                    "agent://permission",
                    json!({
                        "requestId": id,
                        "toolCall": params["toolCall"],
                        "options": params["options"],
                        "autoApproved": true,
                        "selectedOptionId": option_id,
                    }),
                );
                return Box::pin(async move { json!({ "outcome": "selected", "optionId": option_id }) });
            }
        }

        let id = format!("perm-{}", self.next.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.waiters.lock().unwrap().insert(id.clone(), tx);
        self.events.emit("agent://permission", json!({ "requestId": id, "toolCall": params["toolCall"], "options": params["options"] }));
        Box::pin(async move { rx.await.unwrap_or_else(|_| cancelled()) })
    }
}

fn cancelled() -> Value {
    json!({ "outcome": "cancelled" })
}

/// One ACP session for the open project: the connection, its turn state and pending permission prompts.
const START_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

pub struct Session {
    client: AcpClient,
    root: PathBuf,
    agent_id: String,
    events: Arc<dyn SessionEvents>,
    session_id: Mutex<Option<String>>,
    turn_active: AtomicBool,
    waiters: Waiters,
    /// the agent process, when there is one (tests drive a pipe instead)
    pub child: Mutex<Option<tokio::process::Child>>,
    closing: AtomicBool,
    mcp_port: Mutex<Option<u16>>,
    auto_approve: Arc<AtomicBool>,
}

impl Session {
    pub fn connect<R, W>(reader: R, writer: W, root: PathBuf, agent_id: String, events: Arc<dyn SessionEvents>) -> Arc<Session>
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        Self::connect_with_mcp(reader, writer, root, agent_id, events, None)
    }

    #[allow(dead_code)]
    pub fn connect_with_mcp<R, W>(
        reader: R,
        writer: W,
        root: PathBuf,
        agent_id: String,
        events: Arc<dyn SessionEvents>,
        mcp_port: Option<u16>,
    ) -> Arc<Session>
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let waiters: Waiters = Default::default();
        let auto_approve = Arc::new(AtomicBool::new(false));
        let bridge = Arc::new(Bridge {
            events: events.clone(),
            waiters: waiters.clone(),
            next: AtomicU64::new(1),
            auto_approve: auto_approve.clone(),
        });
        let handler = Arc::new(ClientHandler { root: root.clone(), events: bridge });
        let client = AcpClient::new(Connection::start(reader, writer, handler));
        Arc::new(Session {
            client,
            root,
            agent_id,
            events,
            session_id: Mutex::new(None),
            turn_active: AtomicBool::new(false),
            waiters,
            child: Mutex::new(None),
            closing: AtomicBool::new(false),
            mcp_port: Mutex::new(mcp_port),
            auto_approve,
        })
    }

    pub fn set_auto_approve(&self, enabled: bool) {
        self.auto_approve.store(enabled, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn auto_approve(&self) -> bool {
        self.auto_approve.load(Ordering::Relaxed)
    }

    #[allow(dead_code)]
    pub fn with_auto_approve(self: Arc<Self>, enabled: bool) -> Arc<Self> {
        self.set_auto_approve(enabled);
        self
    }

    pub fn set_mcp_port(&self, port: u16) {
        *self.mcp_port.lock().unwrap() = Some(port);
    }

    #[allow(dead_code)]
    pub fn with_mcp_port(self: Arc<Self>, port: u16) -> Arc<Self> {
        self.set_mcp_port(port);
        self
    }

    #[allow(dead_code)]
    pub fn mcp_port(&self) -> Option<u16> {
        *self.mcp_port.lock().unwrap()
    }

    /// Stops the agent on purpose (so its exit isn't reported as a crash).
    pub fn close(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.start_kill();
        }
    }

    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst)
    }

    pub fn connection(&self) -> &Connection {
        &self.client.conn
    }

    pub fn status(&self, state: &str, extra: Value) {
        let mut payload = json!({ "state": state, "agentId": self.agent_id });
        if let (Some(p), Some(e)) = (payload.as_object_mut(), extra.as_object()) {
            p.extend(e.clone());
        }
        self.events.emit("agent://status", payload);
    }

    async fn open_session(&self) -> Result<(), ProjectError> {
        let mcp_servers = match *self.mcp_port.lock().unwrap() {
            Some(port) => {
                let command = std::env::current_exe()
                    .unwrap_or_else(|_| PathBuf::from("desktop"))
                    .to_string_lossy()
                    .into_owned();
                vec![json!({
                    "type": "stdio",
                    "name": "liosvideo",
                    "command": command,
                    "args": ["--mcp-bridge", port.to_string()],
                    "env": []
                })]
            }
            None => vec![],
        };
        eprintln!("[acp:session/new] cwd: {:?}, mcp_servers: {}", self.root, serde_json::to_string(&mcp_servers).unwrap_or_default());
        match self.client.new_session(&self.root, mcp_servers).await {
            Ok(setup) => {
                *self.session_id.lock().unwrap() = Some(setup.session_id);
                let info = self.client.info();
                self.status("ready", json!({
                    "agentInfo": info.raw["agentInfo"],
                    "capabilities": { "loadSession": info.load_session, "image": info.image, "embeddedContext": info.embedded_context },
                    "configOptions": setup.config_options,
                    "models": setup.models,
                }));
                Ok(())
            }
            Err(SessionError::AuthRequired(methods)) => {
                self.status("auth_required", json!({ "authMethods": methods }));
                Ok(())
            }
            Err(SessionError::Rpc(e)) => {
                eprintln!("[acp:session/new:error] code={}, message={}, data={:?}", e.code, e.message, e.data);
                self.status("error", json!({ "message": e.message }));
                Err(ProjectError::Other(e.message))
            }
        }
    }

    pub async fn set_config_option(&self, config_id: &str, value: Value) -> Result<Value, ProjectError> {
        let session_id = self.session_id.lock().unwrap().clone().ok_or_else(|| ProjectError::Other("The agent isn't ready".into()))?;
        self.client.set_config_option(&session_id, config_id, value).await.map_err(|e| ProjectError::Other(e.message))
    }

    /// `initialize` + `session/new`; reports ready, auth_required or error through status events.
    pub async fn start(&self) -> Result<(), ProjectError> {
        self.start_within(START_TIMEOUT).await
    }

    /// `start`, giving up (and stopping the agent) when `initialize` isn't answered within `limit`.
    /// `session/new` gets no limit: some agents (Command Code) take over a minute to create a
    /// session, and Reconnect stays available meanwhile.
    pub async fn start_within(&self, limit: std::time::Duration) -> Result<(), ProjectError> {
        self.status("connecting", json!({}));
        match tokio::time::timeout(limit, self.client.initialize()).await {
            Ok(Ok(_)) => self.open_session().await,
            Ok(Err(e)) => {
                self.status("error", json!({ "message": e.message }));
                Err(ProjectError::Other(e.message))
            }
            Err(_) => {
                let message = format!("The agent didn't respond within {} s", limit.as_secs());
                self.close();
                self.status("error", json!({ "message": message }));
                Err(ProjectError::Other(message))
            }
        }
    }

    pub async fn authenticate(&self, method_id: &str) -> Result<(), ProjectError> {
        self.client.authenticate(method_id).await.map_err(|e| ProjectError::Other(e.message))?;
        self.open_session().await
    }

    async fn commit(&self, message: String) -> Option<CommitInfo> {
        let root = self.root.clone();
        let commit = git_job(move || {
            if git::history_status(&root) != git::HistoryStatus::Enabled || !git::can_auto_commit(&root) {
                return Ok(None);
            }
            git::commit_all(&root, &message)
        })
        .await
        .ok()
        .flatten();
        if let Some(c) = &commit {
            self.events.emit("project://committed", serde_json::to_value(c).unwrap_or_default());
        }
        commit
    }

    /// One turn: commit outside edits, prompt, then commit whatever the agent changed (even if it failed or was cancelled).
    pub async fn prompt(&self, text: &str, sel: Option<&SelectionContext>, images: Option<&[ImageInput]>) -> Result<String, ProjectError> {
        let session_id = self.session_id.lock().unwrap().clone().ok_or_else(|| ProjectError::Other("The agent isn't ready".into()))?;
        if self.turn_active.swap(true, Ordering::SeqCst) {
            return Err(ProjectError::Other("A turn is already running".into()));
        }
        self.commit(git::MANUAL_EDIT.to_string()).await;
        self.events.emit("agent://turn", json!({ "state": "started" }));
        let result = self.client.prompt(&session_id, build_prompt(text, sel, images)).await;
        let commit = self.commit(turn_commit_message(text)).await;
        self.turn_active.store(false, Ordering::SeqCst);
        match result {
            Ok(stop) => {
                self.events.emit("agent://turn", json!({ "state": "ended", "stopReason": stop, "commit": commit }));
                Ok(stop)
            }
            Err(e) => {
                self.events.emit("agent://turn", json!({ "state": "ended", "error": e.message, "commit": commit }));
                Err(ProjectError::Other(e.message))
            }
        }
    }

    /// Asks the agent to stop and answers every open permission prompt as cancelled.
    pub async fn cancel(&self) {
        for (_, tx) in self.waiters.lock().unwrap().drain() {
            let _ = tx.send(cancelled());
        }
        let session_id = self.session_id.lock().unwrap().clone();
        if let Some(id) = session_id {
            let _ = self.client.cancel(&id).await;
        }
    }

    pub fn respond(&self, request_id: &str, option_id: Option<String>) {
        if let Some(tx) = self.waiters.lock().unwrap().remove(request_id) {
            let outcome = match option_id {
                Some(id) => json!({ "outcome": "selected", "optionId": id }),
                None => cancelled(),
            };
            let _ = tx.send(outcome);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::fake::{pair, FakeAgent};
    use crate::git;
    use std::fs;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<(String, Value)>>);

    impl SessionEvents for Recorder {
        fn emit(&self, event: &str, payload: Value) {
            self.0.lock().unwrap().push((event.to_string(), payload));
        }
    }

    impl Recorder {
        fn of(&self, event: &str) -> Vec<Value> {
            self.0.lock().unwrap().iter().filter(|(e, _)| e == event).map(|(_, p)| p.clone()).collect()
        }
    }

    fn sel(path: Option<&str>, playhead: Option<u32>) -> SelectionContext {
        SelectionContext {
            composition: "long.ts".into(),
            scene_id: "intro".into(),
            scene_file: Some("scenes/intro.ts".into()),
            path: path.map(str::to_string),
            start_frame: 30,
            end_frame: 75,
            fps: 30.0,
            playhead_frame: playhead,
        }
    }

    #[test]
    fn build_prompt_without_and_with_selection() {
        assert_eq!(build_prompt("make it blue", None, None), vec![json!({"type": "text", "text": "make it blue"})]);
        let blocks = build_prompt("make it blue", Some(&sel(Some("intro/desktop/terminal"), Some(36))), None);
        assert_eq!(blocks.len(), 2);
        assert_eq!(
            blocks[1]["text"],
            "Selected on the timeline (confine edits to this unless asked otherwise):\ncomposition: long.ts\nscene: intro (file: scenes/intro.ts)\nobject: desktop/terminal\ntime: 1.00s–2.50s (frames 30–75)\nplayhead: 1.20s (frame 36)"
        );
        let scene_only = build_prompt("x", Some(&sel(None, None)), None);
        assert_eq!(
            scene_only[1]["text"],
            "Selected on the timeline (confine edits to this unless asked otherwise):\ncomposition: long.ts\nscene: intro (file: scenes/intro.ts)\ntime: 1.00s–2.50s (frames 30–75)"
        );

        let img_blocks = build_prompt(
            "use this logo",
            None,
            Some(&[ImageInput {
                data: "base64data".into(),
                mime_type: "image/png".into(),
                rel_path: Some("assets/images/logo.png".into()),
            }]),
        );
        assert_eq!(img_blocks.len(), 2);
        assert!(img_blocks[0]["text"].as_str().unwrap().contains("assets/images/logo.png"));
        assert_eq!(img_blocks[1], json!({"type": "image", "data": "base64data", "mimeType": "image/png"}));
    }

    #[test]
    fn turn_commit_message_first_line_and_truncation() {
        assert_eq!(turn_commit_message("\n  make   the title blue \nand bigger"), "make the title blue");
        let long = "a".repeat(100);
        let m = turn_commit_message(&long);
        assert_eq!(m.chars().count(), 72);
        assert!(m.ends_with('…'));
        assert_eq!(turn_commit_message("  \n "), "Agent turn");
    }

    fn project(history: bool) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        fs::write(dir.path().join("scenes/intro.ts"), "old").unwrap();
        if history {
            git::enable_history(dir.path()).unwrap();
        }
        dir
    }

    async fn started(root: &std::path::Path) -> (Arc<Session>, FakeAgent, Arc<Recorder>) {
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let session = Session::connect(r, w, root.canonicalize().unwrap(), "fake".into(), rec.clone());
        let s = session.clone();
        let start = tokio::spawn(async move { s.start().await });
        let m = agent.recv_method("initialize").await;
        agent.reply(&m["id"], json!({"protocolVersion": 1, "authMethods": []})).await;
        let m = agent.recv_method("session/new").await;
        agent.reply(&m["id"], json!({"sessionId": "s1"})).await;
        start.await.unwrap().unwrap();
        assert_eq!(rec.of("agent://status").last().unwrap()["state"], "ready");
        (session, agent, rec)
    }

    #[tokio::test]
    async fn start_gives_up_on_a_silent_agent() {
        let dir = project(false);
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let session = Session::connect(r, w, dir.path().canonicalize().unwrap(), "fake".into(), rec.clone());
        let s = session.clone();
        let start = tokio::spawn(async move { s.start_within(std::time::Duration::from_millis(50)).await });
        agent.recv_method("initialize").await; // never answered
        assert!(start.await.unwrap().is_err());
        let last = rec.of("agent://status").last().unwrap().clone();
        assert_eq!(last["state"], "error");
        assert!(last["message"].as_str().unwrap().contains("didn't respond"));
        assert!(session.is_closing());
    }

    #[tokio::test]
    async fn start_waits_out_a_slow_session_new() {
        // Command Code answers initialize at once but takes over a minute to create a session
        let dir = project(false);
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let session = Session::connect(r, w, dir.path().canonicalize().unwrap(), "fake".into(), rec.clone());
        let s = session.clone();
        let start = tokio::spawn(async move { s.start_within(std::time::Duration::from_millis(50)).await });
        let m = agent.recv_method("initialize").await;
        agent.reply(&m["id"], json!({"protocolVersion": 1, "authMethods": []})).await;
        let m = agent.recv_method("session/new").await;
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        agent.reply(&m["id"], json!({"sessionId": "s1"})).await;
        start.await.unwrap().unwrap();
        assert_eq!(rec.of("agent://status").last().unwrap()["state"], "ready");
        assert!(!session.is_closing());
    }

    #[tokio::test]
    async fn open_session_emits_config_options_and_sets_option() {
        let dir = project(false);
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let session = Session::connect(r, w, dir.path().canonicalize().unwrap(), "fake".into(), rec.clone());
        let s = session.clone();
        let start = tokio::spawn(async move { s.start().await });
        let m = agent.recv_method("initialize").await;
        agent.reply(&m["id"], json!({"protocolVersion": 1, "authMethods": []})).await;
        let m = agent.recv_method("session/new").await;
        agent.reply(&m["id"], json!({
            "sessionId": "s1",
            "configOptions": [{
                "id": "model",
                "name": "Model",
                "category": "model",
                "currentValue": "gpt-5",
                "options": [{"value": "gpt-5", "name": "GPT-5"}, {"value": "gpt-4.1", "name": "GPT-4.1"}]
            }]
        })).await;
        start.await.unwrap().unwrap();
        let last_status = rec.of("agent://status").last().unwrap().clone();
        assert_eq!(last_status["state"], "ready");
        assert_eq!(last_status["configOptions"][0]["id"], "model");
        assert_eq!(last_status["configOptions"][0]["currentValue"], "gpt-5");

        let s2 = session.clone();
        let set_fut = tokio::spawn(async move {
            s2.set_config_option("model", json!("gpt-4.1")).await
        });
        let m = agent.recv_method("session/set_config_option").await;
        assert_eq!(m["params"]["value"], "gpt-4.1");
        agent.reply(&m["id"], json!({"status": "ok"})).await;
        let res = set_fut.await.unwrap().unwrap();
        assert_eq!(res["status"], "ok");
    }

    fn summaries(root: &std::path::Path) -> Vec<String> {
        git::history(root, 10).unwrap().into_iter().map(|c| c.summary).collect()
    }

    #[tokio::test]
    async fn turn_commits_manual_edits_before_and_agent_changes_after() {
        let dir = project(true);
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("scenes/extra.ts"), "outside edit").unwrap();
        let (session, mut agent, rec) = started(&root).await;
        let s = session.clone();
        let turn = tokio::spawn(async move { s.prompt("Make the title blue", None, None).await });
        let p = agent.recv_method("session/prompt").await;
        assert_eq!(p["params"]["sessionId"], "s1");
        assert_eq!(summaries(&root)[0], "Manual edit", "outside edits committed before the prompt");
        let path = root.join("scenes/intro.ts").to_string_lossy().into_owned();
        agent.send(json!({"jsonrpc": "2.0", "id": 900, "method": "fs/write_text_file", "params": {"sessionId": "s1", "path": path, "content": "blue"}})).await;
        agent.recv().await; // write reply
        agent.send(json!({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "s1", "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Done"}}}})).await;
        agent.reply(&p["id"], json!({"stopReason": "end_turn"})).await;
        assert_eq!(turn.await.unwrap().unwrap(), "end_turn");
        assert_eq!(summaries(&root), vec!["Make the title blue", "Manual edit", "Start history"]);
        assert_eq!(rec.of("agent://update")[0]["update"]["content"]["text"], "Done");
        let turns = rec.of("agent://turn");
        assert_eq!(turns[0]["state"], "started");
        assert_eq!(turns[1]["state"], "ended");
        assert_eq!(turns[1]["stopReason"], "end_turn");
        assert_eq!(turns[1]["commit"]["summary"], "Make the title blue");
        assert_eq!(rec.of("project://committed").len(), 2);
    }

    #[tokio::test]
    async fn turn_without_history_commits_nothing() {
        let dir = project(false);
        let root = dir.path().canonicalize().unwrap();
        let (session, mut agent, _) = started(&root).await;
        let s = session.clone();
        let turn = tokio::spawn(async move { s.prompt("hi", None, None).await });
        let p = agent.recv_method("session/prompt").await;
        agent.reply(&p["id"], json!({"stopReason": "end_turn"})).await;
        turn.await.unwrap().unwrap();
        assert!(!root.join(".git").exists());
    }

    #[tokio::test]
    async fn second_prompt_while_turn_active_is_rejected() {
        let dir = project(false);
        let root = dir.path().canonicalize().unwrap();
        let (session, mut agent, _) = started(&root).await;
        let s = session.clone();
        let turn = tokio::spawn(async move { s.prompt("first", None, None).await });
        let p = agent.recv_method("session/prompt").await;
        let err = session.prompt("second", None, None).await.unwrap_err();
        assert!(err.to_string().contains("already running"), "{err}");
        agent.reply(&p["id"], json!({"stopReason": "end_turn"})).await;
        turn.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn cancel_answers_pending_permission_as_cancelled() {
        let dir = project(true);
        let root = dir.path().canonicalize().unwrap();
        let (session, mut agent, rec) = started(&root).await;
        let s = session.clone();
        let turn = tokio::spawn(async move { s.prompt("risky", None, None).await });
        let p = agent.recv_method("session/prompt").await;
        let path = root.join("scenes/intro.ts").to_string_lossy().into_owned();
        agent.send(json!({"jsonrpc": "2.0", "id": 901, "method": "fs/write_text_file", "params": {"sessionId": "s1", "path": path, "content": "half done"}})).await;
        agent.recv().await;
        let options = json!([{"optionId": "allow", "name": "Allow once", "kind": "allow_once"}]);
        agent.send(json!({"jsonrpc": "2.0", "id": 902, "method": "session/request_permission", "params": {"sessionId": "s1", "toolCall": {"toolCallId": "t1", "title": "rm -rf"}, "options": options}})).await;
        // wait until the permission reached the UI
        while rec.of("agent://permission").is_empty() {
            tokio::task::yield_now().await;
        }
        assert_eq!(rec.of("agent://permission")[0]["toolCall"]["title"], "rm -rf");
        session.cancel().await;
        let (mut got_cancel, mut got_outcome) = (false, false);
        while !(got_cancel && got_outcome) {
            let m = agent.recv().await;
            if m["method"] == "session/cancel" {
                got_cancel = true;
            } else if m["id"] == 902 {
                assert_eq!(m["result"], json!({"outcome": {"outcome": "cancelled"}}));
                got_outcome = true;
            }
        }
        agent.reply(&p["id"], json!({"stopReason": "cancelled"})).await;
        assert_eq!(turn.await.unwrap().unwrap(), "cancelled");
        assert_eq!(summaries(&root)[0], "risky", "work done before the cancel is committed");
    }

    #[tokio::test]
    async fn respond_selects_an_option() {
        let dir = project(false);
        let root = dir.path().canonicalize().unwrap();
        let (session, mut agent, rec) = started(&root).await;
        let options = json!([{"optionId": "allow", "name": "Allow once", "kind": "allow_once"}]);
        agent.send(json!({"jsonrpc": "2.0", "id": 903, "method": "session/request_permission", "params": {"sessionId": "s1", "toolCall": {"toolCallId": "t1"}, "options": options}})).await;
        while rec.of("agent://permission").is_empty() {
            tokio::task::yield_now().await;
        }
        let id = rec.of("agent://permission")[0]["requestId"].as_str().unwrap().to_string();
        session.respond(&id, Some("allow".into()));
        let m = agent.recv().await;
        assert_eq!(m["result"], json!({"outcome": {"outcome": "selected", "optionId": "allow"}}));
    }

    #[tokio::test]
    async fn auto_approve_immediately_selects_allow_option() {
        let dir = project(false);
        let root = dir.path().canonicalize().unwrap();
        let (session, mut agent, rec) = started(&root).await;
        session.set_auto_approve(true);
        assert!(session.auto_approve());

        let options = json!([
            {"optionId": "reject-id", "name": "Reject", "kind": "reject_once"},
            {"optionId": "allow-id", "name": "Allow once", "kind": "allow_once"}
        ]);
        agent.send(json!({
            "jsonrpc": "2.0",
            "id": 904,
            "method": "session/request_permission",
            "params": {"sessionId": "s1", "toolCall": {"toolCallId": "t1", "title": "Execute script"}, "options": options}
        })).await;

        let m = agent.recv().await;
        assert_eq!(m["id"], 904);
        assert_eq!(m["result"], json!({"outcome": {"outcome": "selected", "optionId": "allow-id"}}));

        let perms = rec.of("agent://permission");
        assert_eq!(perms.len(), 1);
        assert_eq!(perms[0]["autoApproved"], true);
        assert_eq!(perms[0]["selectedOptionId"], "allow-id");
    }

    #[tokio::test]
    async fn agent_exit_mid_turn_ends_turn_with_error() {
        let dir = project(false);
        let root = dir.path().canonicalize().unwrap();
        let (session, mut agent, rec) = started(&root).await;
        let s = session.clone();
        let turn = tokio::spawn(async move { s.prompt("hi", None, None).await });
        agent.recv_method("session/prompt").await;
        agent.hang_up().await;
        let err = turn.await.unwrap().unwrap_err();
        assert!(err.to_string().contains("Agent exited"), "{err}");
        let ended = rec.of("agent://turn").last().unwrap().clone();
        assert_eq!(ended["state"], "ended");
        assert!(ended["error"].as_str().unwrap().contains("Agent exited"));
    }

    #[tokio::test]
    async fn auth_required_is_reported_with_methods() {
        let dir = project(false);
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let session = Session::connect(r, w, dir.path().canonicalize().unwrap(), "fake".into(), rec.clone());
        let s = session.clone();
        let start = tokio::spawn(async move { s.start().await });
        let m = agent.recv_method("initialize").await;
        agent.reply(&m["id"], json!({"protocolVersion": 1, "authMethods": [{"id": "login", "name": "Log in"}]})).await;
        let m = agent.recv_method("session/new").await;
        agent.send(json!({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32000, "message": "Authentication required"}})).await;
        start.await.unwrap().unwrap();
        let status = rec.of("agent://status").last().unwrap().clone();
        assert_eq!(status["state"], "auth_required");
        assert_eq!(status["authMethods"][0]["id"], "login");
    }

    #[tokio::test]
    async fn session_passes_editor_mcp_server_to_new_session() {
        let dir = project(false);
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let session = Session::connect(r, w, dir.path().canonicalize().unwrap(), "fake".into(), rec.clone())
            .with_mcp_port(8765);
        let s = session.clone();
        let start = tokio::spawn(async move { s.start().await });
        let m = agent.recv_method("initialize").await;
        agent.reply(&m["id"], json!({"protocolVersion": 1, "authMethods": []})).await;
        let m = agent.recv_method("session/new").await;
        agent.reply(&m["id"], json!({"sessionId": "s1"})).await;
        start.await.unwrap().unwrap();

        let mcp_servers = &m["params"]["mcpServers"];
        assert_eq!(mcp_servers[0]["name"], "liosvideo");
        assert_eq!(mcp_servers[0]["type"], "stdio");
        assert_eq!(mcp_servers[0]["env"], json!([]));
        let args = mcp_servers[0]["args"].as_array().expect("args array");
        assert!(args.iter().any(|a| a == "--mcp-bridge"));
        assert!(args.iter().any(|a| a == "8765"));
    }

    #[test]
    fn test_image_input_deserialization() {
        let json_camel = r#"{"data": "abc", "mimeType": "image/png", "relPath": "assets/test.png"}"#;
        let parsed: ImageInput = serde_json::from_str(json_camel).expect("deserialize camelCase");
        assert_eq!(parsed.data, "abc");
        assert_eq!(parsed.mime_type, "image/png");
        assert_eq!(parsed.rel_path.as_deref(), Some("assets/test.png"));

        let json_snake = r#"{"data": "xyz", "mime_type": "image/jpeg", "rel_path": null}"#;
        let parsed_snake: ImageInput = serde_json::from_str(json_snake).expect("deserialize snake_case");
        assert_eq!(parsed_snake.data, "xyz");
        assert_eq!(parsed_snake.mime_type, "image/jpeg");
        assert_eq!(parsed_snake.rel_path, None);
    }
}
