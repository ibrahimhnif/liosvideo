use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};

use super::rpc::{BoxFuture, Connection, Handler, RpcError, INVALID_PARAMS, METHOD_NOT_FOUND};
use crate::project::resolve_in_project;

pub const PROTOCOL_VERSION: u64 = 1;
pub const AUTH_REQUIRED: i64 = -32000;

#[derive(Debug, Clone, Default)]
pub struct AgentInfo {
    pub auth_methods: Vec<Value>,
    pub load_session: bool,
    pub image: bool,
    pub embedded_context: bool,
    pub raw: Value,
}

#[derive(Debug)]
pub enum SessionError {
    AuthRequired(Vec<Value>),
    Rpc(RpcError),
}

pub trait ClientEvents: Send + Sync + 'static {
    fn update(&self, update: Value);
    /// Resolves to an ACP outcome object: `{"outcome": "selected", "optionId": ..}` or `{"outcome": "cancelled"}`.
    fn permission(&self, params: Value) -> BoxFuture<Value>;
}

#[derive(Clone)]
pub struct AcpClient {
    pub conn: Connection,
    info: Arc<std::sync::Mutex<AgentInfo>>,
}

impl AcpClient {
    pub fn new(conn: Connection) -> Self {
        Self { conn, info: Default::default() }
    }

    pub async fn initialize(&self) -> Result<AgentInfo, RpcError> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true }, "terminal": false },
            "clientInfo": { "name": "liosvideo", "title": "liosvideo", "version": env!("CARGO_PKG_VERSION") },
        });
        let raw = self.conn.request("initialize", params).await?;
        let caps = &raw["agentCapabilities"];
        let info = AgentInfo {
            auth_methods: raw["authMethods"].as_array().cloned().unwrap_or_default(),
            load_session: caps["loadSession"].as_bool().unwrap_or(false),
            image: caps["promptCapabilities"]["image"].as_bool().unwrap_or(false),
            embedded_context: caps["promptCapabilities"]["embeddedContext"].as_bool().unwrap_or(false),
            raw: raw.clone(),
        };
        *self.info.lock().unwrap() = info.clone();
        Ok(info)
    }

    pub async fn new_session(&self, cwd: &Path, mcp_servers: Vec<Value>) -> Result<String, SessionError> {
        let params = json!({ "cwd": cwd, "mcpServers": mcp_servers });
        match self.conn.request("session/new", params).await {
            Ok(r) => r["sessionId"].as_str().map(str::to_string).ok_or_else(|| SessionError::Rpc(RpcError::new(-32603, "session/new returned no sessionId"))),
            Err(e) if e.code == AUTH_REQUIRED => Err(SessionError::AuthRequired(self.info.lock().unwrap().auth_methods.clone())),
            Err(e) => Err(SessionError::Rpc(e)),
        }
    }

    pub async fn authenticate(&self, method_id: &str) -> Result<(), RpcError> {
        self.conn.request("authenticate", json!({ "methodId": method_id })).await.map(drop)
    }

    /// Runs one prompt turn; resolves with the agent's stop reason.
    pub async fn prompt(&self, session_id: &str, blocks: Vec<Value>) -> Result<String, RpcError> {
        let r = self.conn.request("session/prompt", json!({ "sessionId": session_id, "prompt": blocks })).await?;
        Ok(r["stopReason"].as_str().unwrap_or("end_turn").to_string())
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), RpcError> {
        self.conn.notify("session/cancel", json!({ "sessionId": session_id })).await
    }
}

/// Answers the agent's requests: project-scoped file access, permission prompts, streamed updates.
pub struct ClientHandler {
    pub root: PathBuf,
    pub events: Arc<dyn ClientEvents>,
}

impl ClientHandler {
    /// The agent sends absolute paths; only ones inside the project (no escapes, no outside symlinks) resolve.
    fn resolve(&self, params: &Value) -> Result<PathBuf, RpcError> {
        let outside = || RpcError::new(INVALID_PARAMS, "path is outside the project");
        let path = Path::new(params["path"].as_str().ok_or_else(|| RpcError::new(INVALID_PARAMS, "missing path"))?);
        let rel = path.strip_prefix(&self.root).map_err(|_| outside())?;
        resolve_in_project(&self.root, &rel.to_string_lossy()).map_err(|_| outside())
    }

    fn read(&self, params: &Value) -> Result<Value, RpcError> {
        let path = self.resolve(params)?;
        let text = std::fs::read_to_string(&path).map_err(|e| RpcError::new(-32603, e.to_string()))?;
        let start = params["line"].as_u64().unwrap_or(1).max(1) as usize - 1;
        let limit = params["limit"].as_u64().map(|l| l as usize).unwrap_or(usize::MAX);
        let content: String = if start == 0 && limit == usize::MAX {
            text
        } else {
            text.split_inclusive('\n').skip(start).take(limit).collect()
        };
        Ok(json!({ "content": content }))
    }

    fn write(&self, params: &Value) -> Result<Value, RpcError> {
        let path = self.resolve(params)?;
        let content = params["content"].as_str().ok_or_else(|| RpcError::new(INVALID_PARAMS, "missing content"))?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| RpcError::new(-32603, e.to_string()))?;
        }
        std::fs::write(&path, content).map_err(|e| RpcError::new(-32603, e.to_string()))?;
        Ok(json!({}))
    }
}

impl Handler for ClientHandler {
    fn request(&self, method: String, params: Value) -> BoxFuture<Result<Value, RpcError>> {
        match method.as_str() {
            "fs/read_text_file" => {
                let r = self.read(&params);
                Box::pin(async move { r })
            }
            "fs/write_text_file" => {
                let r = self.write(&params);
                Box::pin(async move { r })
            }
            "session/request_permission" => {
                let outcome = self.events.permission(params);
                Box::pin(async move { Ok(json!({ "outcome": outcome.await })) })
            }
            _ => Box::pin(async move { Err(RpcError::new(METHOD_NOT_FOUND, format!("{method} is not supported"))) }),
        }
    }

    fn notification(&self, method: String, params: Value) {
        if method == "session/update" {
            self.events.update(params["update"].clone());
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::acp::fake::{pair, FakeAgent};
    use std::fs;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct Events {
        pub updates: Mutex<Vec<Value>>,
        pub permissions: Mutex<Vec<Value>>,
    }

    impl ClientEvents for Events {
        fn update(&self, update: Value) {
            self.updates.lock().unwrap().push(update);
        }
        fn permission(&self, params: Value) -> BoxFuture<Value> {
            let option = params["options"][0]["optionId"].clone();
            self.permissions.lock().unwrap().push(params);
            Box::pin(async move { json!({"outcome": "selected", "optionId": option}) })
        }
    }

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        fs::write(dir.path().join("scenes/a.ts"), "l1\nl2\nl3\nl4\n").unwrap();
        dir
    }

    fn connect(root: &Path) -> (AcpClient, FakeAgent, Arc<Events>) {
        let (r, w, agent) = pair();
        let events = Arc::new(Events::default());
        let handler = Arc::new(ClientHandler { root: root.canonicalize().unwrap(), events: events.clone() });
        (AcpClient::new(Connection::start(r, w, handler)), agent, events)
    }

    async fn ask(agent: &mut FakeAgent, id: u64, method: &str, params: Value) -> Value {
        agent.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})).await;
        loop {
            let m = agent.recv().await;
            if m["id"] == id && m.get("method").is_none() {
                return m;
            }
        }
    }

    #[tokio::test]
    async fn initialize_sends_capabilities_and_parses_auth_methods() {
        let dir = project();
        let (client, mut agent, _) = connect(dir.path());
        let t = tokio::spawn(async move { client.initialize().await });
        let m = agent.recv_method("initialize").await;
        assert_eq!(m["params"]["protocolVersion"], 1);
        assert_eq!(m["params"]["clientCapabilities"]["fs"], json!({"readTextFile": true, "writeTextFile": true}));
        assert_eq!(m["params"]["clientCapabilities"]["terminal"], false);
        assert_eq!(m["params"]["clientInfo"]["name"], "liosvideo");
        agent.reply(&m["id"], json!({"protocolVersion": 1, "agentCapabilities": {"loadSession": true, "promptCapabilities": {"image": true}}, "authMethods": [{"id": "login", "name": "Log in"}]})).await;
        let info = t.await.unwrap().unwrap();
        assert!(info.load_session && info.image && !info.embedded_context);
        assert_eq!(info.auth_methods[0]["id"], "login");
    }

    #[tokio::test]
    async fn new_session_maps_auth_required() {
        let dir = project();
        let (client, mut agent, _) = connect(dir.path());
        let c = client.clone();
        let t = tokio::spawn(async move {
            c.initialize().await.unwrap();
            c.new_session(Path::new("/tmp/p"), vec![]).await
        });
        let m = agent.recv_method("initialize").await;
        agent.reply(&m["id"], json!({"protocolVersion": 1, "authMethods": [{"id": "oauth", "name": "Sign in"}]})).await;
        let m = agent.recv_method("session/new").await;
        assert_eq!(m["params"]["cwd"], "/tmp/p");
        assert_eq!(m["params"]["mcpServers"], json!([]));
        agent.send(json!({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32000, "message": "Authentication required"}})).await;
        match t.await.unwrap() {
            Err(SessionError::AuthRequired(methods)) => assert_eq!(methods[0]["id"], "oauth"),
            other => panic!("expected auth required, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fs_read_inside_project_with_line_and_limit() {
        let dir = project();
        let root = dir.path().canonicalize().unwrap();
        let (_client, mut agent, _) = connect(dir.path());
        let path = root.join("scenes/a.ts").to_string_lossy().into_owned();
        let all = ask(&mut agent, 1, "fs/read_text_file", json!({"sessionId": "s", "path": path})).await;
        assert_eq!(all["result"]["content"], "l1\nl2\nl3\nl4\n");
        let part = ask(&mut agent, 2, "fs/read_text_file", json!({"sessionId": "s", "path": path, "line": 2, "limit": 2})).await;
        assert_eq!(part["result"]["content"], "l2\nl3\n");
    }

    #[tokio::test]
    async fn fs_rejects_outside_relative_and_symlink_escape_paths() {
        let dir = project();
        let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret"), "s").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("link")).unwrap();
        let (_client, mut agent, _) = connect(dir.path());
        let bad = [
            "/etc/passwd".to_string(),
            "scenes/a.ts".to_string(),
            format!("{}/../x", root.display()),
            format!("{}/link/secret", root.display()),
        ];
        for (i, path) in bad.iter().enumerate() {
            let r = ask(&mut agent, 10 + i as u64, "fs/read_text_file", json!({"sessionId": "s", "path": path})).await;
            assert!(r.get("error").is_some(), "read allowed for {path}: {r}");
            let w = ask(&mut agent, 20 + i as u64, "fs/write_text_file", json!({"sessionId": "s", "path": path, "content": "x"})).await;
            assert!(w.get("error").is_some(), "write allowed for {path}: {w}");
        }
        assert_eq!(fs::read_to_string(outside.path().join("secret")).unwrap(), "s");
        assert!(!root.parent().unwrap().join("x").exists());
    }

    #[tokio::test]
    async fn fs_write_creates_parent_dirs() {
        let dir = project();
        let root = dir.path().canonicalize().unwrap();
        let (_client, mut agent, _) = connect(dir.path());
        let path = root.join("scenes/new/b.ts").to_string_lossy().into_owned();
        let r = ask(&mut agent, 1, "fs/write_text_file", json!({"sessionId": "s", "path": path, "content": "hi"})).await;
        assert!(r.get("error").is_none(), "{r}");
        assert_eq!(fs::read_to_string(root.join("scenes/new/b.ts")).unwrap(), "hi");
    }

    #[tokio::test]
    async fn permission_request_round_trips_outcome() {
        let dir = project();
        let (_client, mut agent, events) = connect(dir.path());
        let params = json!({"sessionId": "s", "toolCall": {"toolCallId": "t1"}, "options": [{"optionId": "ok", "name": "Allow once", "kind": "allow_once"}]});
        let r = ask(&mut agent, 1, "session/request_permission", params).await;
        assert_eq!(r["result"], json!({"outcome": {"outcome": "selected", "optionId": "ok"}}));
        assert_eq!(events.permissions.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn session_updates_reach_events() {
        let dir = project();
        let (_client, mut agent, events) = connect(dir.path());
        let update = json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "hi"}});
        agent.send(json!({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "s", "update": update}})).await;
        // a round trip guarantees the notification was processed
        ask(&mut agent, 1, "unknown/thing", json!({})).await;
        assert_eq!(events.updates.lock().unwrap().as_slice(), &[update]);
    }

    #[tokio::test]
    async fn unknown_method_returns_method_not_found() {
        let dir = project();
        let (_client, mut agent, _) = connect(dir.path());
        let r = ask(&mut agent, 1, "terminal/create", json!({})).await;
        assert_eq!(r["error"]["code"], -32601);
    }
}
