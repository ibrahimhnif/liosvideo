use std::io;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::mcp::protocol::handle_mcp_message;
use crate::mcp::tools::ToolRegistry;

pub struct McpServer {
    port: u16,
    shutdown_tx: watch::Sender<bool>,
    task_handle: Mutex<Option<JoinHandle<()>>>,
}

impl McpServer {
    pub fn bind(registry: Arc<ToolRegistry>) -> Result<Self, io::Error> {
        Self::bind_addr("127.0.0.1:0", registry)
    }

    pub fn bind_addr(addr: &str, registry: Arc<ToolRegistry>) -> Result<Self, io::Error> {
        let std_listener = std::net::TcpListener::bind(addr)?;
        std_listener.set_nonblocking(true)?;
        let local_addr = std_listener.local_addr()?;
        let port = local_addr.port();

        let listener = TcpListener::from_std(std_listener)?;

        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

        let task_handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() {
                            break;
                        }
                    }
                    res = listener.accept() => {
                        match res {
                            Ok((socket, _)) => {
                                let registry = Arc::clone(&registry);
                                let mut conn_shutdown_rx = shutdown_rx.clone();
                                tokio::spawn(async move {
                                    handle_connection(socket, registry, &mut conn_shutdown_rx).await;
                                });
                            }
                            Err(e) => {
                                eprintln!("mcp server accept error: {e}");
                                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                            }
                        }
                    }
                }
            }
        });

        Ok(Self {
            port,
            shutdown_tx,
            task_handle: Mutex::new(Some(task_handle)),
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
        if let Ok(mut guard) = self.task_handle.lock()
            && let Some(handle) = guard.take()
        {
            handle.abort();
        }
    }
}

impl Drop for McpServer {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn handle_connection(
    socket: tokio::net::TcpStream,
    registry: Arc<ToolRegistry>,
    shutdown_rx: &mut watch::Receiver<bool>,
) {
    let (reader, mut writer) = socket.into_split();
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
            res = buf_reader.read_line(&mut line) => {
                match res {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if let Some(resp) = handle_mcp_message(&registry, trimmed).await {
                            if writer.write_all(resp.as_bytes()).await.is_err() {
                                break;
                            }
                            if writer.write_all(b"\n").await.is_err() {
                                break;
                            }
                            if writer.flush().await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;
    use serde_json::json;
    use crate::mcp::tools::ToolRegistry;
    use super::*;

    #[tokio::test]
    async fn test_mcp_server_initialize() {
        let registry = Arc::new(ToolRegistry::new());
        let server = McpServer::bind(registry).expect("bind failed");
        let port = server.port();

        let mut client = TcpStream::connect(format!("127.0.0.1:{port}")).await.expect("connect failed");
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        }).to_string() + "\n";

        client.write_all(request.as_bytes()).await.expect("write failed");

        let mut reader = BufReader::new(client);
        let mut response_line = String::new();
        reader.read_line(&mut response_line).await.expect("read failed");

        let res: serde_json::Value = serde_json::from_str(&response_line).expect("valid json");
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 1);
        assert_eq!(res["result"]["serverInfo"]["name"], "liosvideo");
        assert_eq!(res["result"]["serverInfo"]["version"], "0.1.0");

        server.stop();
    }

    #[tokio::test]
    async fn test_mcp_server_multiple_requests_and_notifications() {
        let registry = Arc::new(ToolRegistry::new());
        let server = McpServer::bind(registry).expect("bind failed");
        let port = server.port();

        let client = TcpStream::connect(format!("127.0.0.1:{port}")).await.expect("connect failed");
        let mut reader = BufReader::new(client);

        // 1. Send initialize
        let req1 = json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "initialize",
            "params": {}
        }).to_string() + "\n";
        reader.get_mut().write_all(req1.as_bytes()).await.expect("write failed");

        let mut line1 = String::new();
        reader.read_line(&mut line1).await.expect("read failed");
        let res1: serde_json::Value = serde_json::from_str(&line1).expect("valid json");
        assert_eq!(res1["id"], 10);

        // 2. Send notification (no response expected)
        let notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }).to_string() + "\n";
        reader.get_mut().write_all(notif.as_bytes()).await.expect("write notif failed");

        // 3. Send ping (response expected with id 11)
        let req2 = json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "ping",
            "params": {}
        }).to_string() + "\n";
        reader.get_mut().write_all(req2.as_bytes()).await.expect("write ping failed");

        let mut line2 = String::new();
        reader.read_line(&mut line2).await.expect("read failed");
        let res2: serde_json::Value = serde_json::from_str(&line2).expect("valid json");
        assert_eq!(res2["id"], 11);
        assert_eq!(res2["result"], json!({}));

        server.stop();
    }

    #[tokio::test]
    async fn test_mcp_server_stop() {
        let registry = Arc::new(ToolRegistry::new());
        let server = McpServer::bind(registry).expect("bind failed");
        let port = server.port();

        server.stop();
        // Give a moment for the server task to stop
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Attempting to connect should fail or close
        // Note: the OS TCP listener socket was dropped when McpServer task closed
        // In some OSes, connecting might fail immediately or fail on write/read
        let client_res = TcpStream::connect(format!("127.0.0.1:{port}")).await;
        if let Ok(mut client) = client_res {
            let mut buf = [0u8; 10];
            let read_res = client.read(&mut buf).await;
            // Either read is Err or 0 (EOF)
            assert!(read_res.is_err() || read_res.unwrap() == 0);
        }
    }
}
