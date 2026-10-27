use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), data: None }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

pub const AGENT_EXITED: i64 = -32099;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

pub trait Handler: Send + Sync + 'static {
    fn request(&self, method: String, params: Value) -> BoxFuture<Result<Value, RpcError>>;
    fn notification(&self, method: String, params: Value);
}

type Pending = Arc<Mutex<Option<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>>>;

/// Newline-delimited JSON-RPC 2.0 over a byte stream. `None` in `pending` means the peer is gone.
#[derive(Clone)]
pub struct Connection {
    out: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
    closed: watch::Receiver<bool>,
}

fn exited() -> RpcError {
    RpcError::new(AGENT_EXITED, "Agent exited")
}

impl Connection {
    pub fn start<R, W>(reader: R, mut writer: W, handler: Arc<dyn Handler>) -> Connection
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (out, mut out_rx) = mpsc::unbounded_channel::<String>();
        let pending: Pending = Arc::new(Mutex::new(Some(HashMap::new())));
        let (closed_tx, closed) = watch::channel(false);

        tokio::spawn(async move {
            while let Some(line) = out_rx.recv().await {
                eprintln!("[acp:out] {line}");
                if writer.write_all(line.as_bytes()).await.is_err() || writer.write_all(b"\n").await.is_err() || writer.flush().await.is_err() {
                    break;
                }
            }
        });

        let (pending_r, out_r) = (pending.clone(), out.clone());
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[acp:in] {line}");
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                let method = msg.get("method").and_then(Value::as_str).map(str::to_string);
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                match (method, msg.get("id").cloned()) {
                    (Some(method), Some(id)) => {
                        let (handler, out) = (handler.clone(), out_r.clone());
                        tokio::spawn(async move {
                            let reply = match handler.request(method, params).await {
                                Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
                                Err(error) => json!({"jsonrpc": "2.0", "id": id, "error": error}),
                            };
                            let _ = out.send(reply.to_string());
                        });
                    }
                    (Some(method), None) => handler.notification(method, params),
                    (None, Some(id)) => {
                        let Some(id) = id.as_u64() else { continue };
                        let result = match msg.get("error") {
                            Some(e) => Err(serde_json::from_value(e.clone()).unwrap_or_else(|_| RpcError::new(-32603, e.to_string()))),
                            None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        let tx = pending_r.lock().unwrap().as_mut().and_then(|p| p.remove(&id));
                        if let Some(tx) = tx {
                            let _ = tx.send(result);
                        }
                    }
                    (None, None) => {}
                }
            }
            for (_, tx) in pending_r.lock().unwrap().take().unwrap_or_default() {
                let _ = tx.send(Err(exited()));
            }
            let _ = closed_tx.send(true);
        });

        Connection { out, pending, next_id: Arc::new(AtomicU64::new(1)), closed }
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        match self.pending.lock().unwrap().as_mut() {
            Some(p) => p.insert(id, tx),
            None => return Err(exited()),
        };
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.out.send(msg.to_string()).map_err(|_| exited())?;
        rx.await.unwrap_or_else(|_| Err(exited()))
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), RpcError> {
        if *self.closed.borrow() {
            return Err(exited());
        }
        let msg = json!({"jsonrpc": "2.0", "method": method, "params": params});
        self.out.send(msg.to_string()).map_err(|_| exited())
    }

    /// Resolves once the peer's output has ended.
    pub async fn closed(&self) {
        let mut rx = self.closed.clone();
        let _ = rx.wait_for(|c| *c).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::fake::pair;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<(String, Value)>>);

    impl Handler for Recorder {
        fn request(&self, method: String, params: Value) -> BoxFuture<Result<Value, RpcError>> {
            Box::pin(async move {
                if method == "echo" { Ok(params) } else { Err(RpcError::new(METHOD_NOT_FOUND, "nope")) }
            })
        }
        fn notification(&self, method: String, params: Value) {
            self.0.lock().unwrap().push((method, params));
        }
    }

    #[tokio::test]
    async fn request_response_matching_with_interleaved_notifications() {
        let (r, w, mut agent) = pair();
        let rec = Arc::new(Recorder::default());
        let conn = Connection::start(r, w, rec.clone());
        let (c1, c2) = (conn.clone(), conn.clone());
        let a = tokio::spawn(async move { c1.request("first", json!({"n": 1})).await });
        let b = tokio::spawn(async move { c2.request("second", json!({"n": 2})).await });
        let m1 = agent.recv().await;
        let m2 = agent.recv().await;
        agent.send(json!({"jsonrpc": "2.0", "method": "note", "params": {"x": 1}})).await;
        // answer in reverse order
        for m in [&m2, &m1] {
            let n = m["params"]["n"].clone();
            agent.reply(&m["id"], json!({"got": n})).await;
        }
        let ra = a.await.unwrap().unwrap();
        let rb = b.await.unwrap().unwrap();
        let (first, second) = if m1["method"] == "first" { (ra, rb) } else { (rb, ra) };
        assert_eq!(first, json!({"got": 1}));
        assert_eq!(second, json!({"got": 2}));
        assert_eq!(rec.0.lock().unwrap().as_slice(), &[("note".to_string(), json!({"x": 1}))]);
    }

    #[tokio::test]
    async fn incoming_requests_get_results_and_errors() {
        let (r, w, mut agent) = pair();
        let _conn = Connection::start(r, w, Arc::new(Recorder::default()));
        agent.send(json!({"jsonrpc": "2.0", "id": 7, "method": "echo", "params": {"a": 1}})).await;
        let reply = agent.recv().await;
        assert_eq!(reply["id"], 7);
        assert_eq!(reply["result"], json!({"a": 1}));
        agent.send(json!({"jsonrpc": "2.0", "id": "x", "method": "other", "params": {}})).await;
        let reply = agent.recv().await;
        assert_eq!(reply["id"], "x");
        assert_eq!(reply["error"]["code"], METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn error_responses_become_rpc_errors() {
        let (r, w, mut agent) = pair();
        let conn = Connection::start(r, w, Arc::new(Recorder::default()));
        let c = conn.clone();
        let t = tokio::spawn(async move { c.request("x", json!({})).await });
        let m = agent.recv().await;
        agent.send(json!({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32000, "message": "Authentication required"}})).await;
        assert_eq!(t.await.unwrap().unwrap_err().code, -32000);
    }

    #[tokio::test]
    async fn pending_requests_fail_when_agent_exits() {
        let (r, w, mut agent) = pair();
        let conn = Connection::start(r, w, Arc::new(Recorder::default()));
        let c = conn.clone();
        let t = tokio::spawn(async move { c.request("session/prompt", json!({})).await });
        agent.recv().await;
        agent.hang_up().await;
        let err = t.await.unwrap().unwrap_err();
        assert_eq!(err.code, AGENT_EXITED);
        assert_eq!(err.message, "Agent exited");
        conn.closed().await;
        assert_eq!(conn.request("again", json!({})).await.unwrap_err().code, AGENT_EXITED);
    }
}
