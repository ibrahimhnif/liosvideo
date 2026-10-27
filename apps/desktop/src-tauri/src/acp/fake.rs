//! The far end of a duplex pipe, playing the agent in tests.
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines, ReadHalf, WriteHalf};

pub struct FakeAgent {
    lines: Lines<BufReader<ReadHalf<DuplexStream>>>,
    w: Option<WriteHalf<DuplexStream>>,
}

/// (client reader, client writer, fake agent)
pub fn pair() -> (ReadHalf<DuplexStream>, WriteHalf<DuplexStream>, FakeAgent) {
    let (client, agent) = tokio::io::duplex(1 << 20);
    let (cr, cw) = tokio::io::split(client);
    let (ar, aw) = tokio::io::split(agent);
    (cr, cw, FakeAgent { lines: BufReader::new(ar).lines(), w: Some(aw) })
}

impl FakeAgent {
    pub async fn recv(&mut self) -> Value {
        let line = self.lines.next_line().await.unwrap().expect("client closed");
        serde_json::from_str(&line).unwrap()
    }

    /// Receives until a message with `method` arrives (skipping others).
    pub async fn recv_method(&mut self, method: &str) -> Value {
        loop {
            let m = self.recv().await;
            if m["method"] == method {
                return m;
            }
        }
    }

    pub async fn send(&mut self, v: Value) {
        let w = self.w.as_mut().unwrap();
        w.write_all(format!("{v}\n").as_bytes()).await.unwrap();
        w.flush().await.unwrap();
    }

    pub async fn reply(&mut self, id: &Value, result: Value) {
        self.send(serde_json::json!({"jsonrpc": "2.0", "id": id, "result": result})).await;
    }

    /// Closes the agent's output, as if its process exited.
    pub async fn hang_up(&mut self) {
        if let Some(mut w) = self.w.take() {
            w.shutdown().await.unwrap();
        }
    }
}
