use std::error::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

/// Runs the MCP bridge forwarding bidirectional traffic between `input`/`output`
/// and the TCP server on `127.0.0.1:<port>`.
pub async fn run_bridge_streams<R, W>(
    port: u16,
    mut input: R,
    mut output: W,
) -> Result<(), Box<dyn Error + Send + Sync>>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let addr = format!("127.0.0.1:{port}");
    eprintln!("[mcp:bridge] connecting to {addr}...");
    let stream = match TcpStream::connect(&addr).await {
        Ok(s) => {
            eprintln!("[mcp:bridge] connected to {addr}");
            s
        }
        Err(e) => {
            eprintln!("[mcp:bridge:error] failed to connect to {addr}: {e}");
            return Err(Box::new(e));
        }
    };
    let (mut tcp_read, mut tcp_write) = stream.into_split();

    let client_to_server = async {
        let mut buf = [0u8; 8192];
        loop {
            let n = input.read(&mut buf).await?;
            if n == 0 {
                tcp_write.shutdown().await?;
                break;
            }
            tcp_write.write_all(&buf[..n]).await?;
            tcp_write.flush().await?;
        }
        Ok::<(), std::io::Error>(())
    };

    let server_to_client = async {
        let mut buf = [0u8; 8192];
        loop {
            let n = tcp_read.read(&mut buf).await?;
            if n == 0 {
                output.flush().await?;
                break;
            }
            output.write_all(&buf[..n]).await?;
            output.flush().await?;
        }
        Ok::<(), std::io::Error>(())
    };

    tokio::select! {
        res = client_to_server => {
            if let Err(e) = res {
                return Err(Box::new(e));
            }
        }
        res = server_to_client => {
            if let Err(e) = res {
                return Err(Box::new(e));
            }
        }
    }

    Ok(())
}

/// Asynchronous entry point connecting `stdin` and `stdout` to the TCP server.
pub async fn run_bridge_async(port: u16) -> Result<(), Box<dyn Error + Send + Sync>> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    run_bridge_streams(port, stdin, stdout).await
}

/// Synchronous entry point used by CLI invocations (e.g. `--mcp-bridge <port>`).
/// Creates a dedicated single-threaded Tokio runtime to drive the async I/O.
pub fn run_bridge(port: u16) -> Result<(), Box<dyn Error>> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(run_bridge_async(port)).map_err(|e| -> Box<dyn Error> { e })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use crate::mcp::server::McpServer;
    use crate::mcp::tools::ToolRegistry;
    use super::*;

    #[tokio::test]
    async fn test_bridge_forwards_to_mcp_server() {
        let registry = Arc::new(ToolRegistry::new());
        let server = McpServer::bind(registry).expect("bind failed");
        let port = server.port();

        // Create virtual streams simulating client stdin/stdout
        let (client_tx, bridge_rx) = tokio::io::duplex(4096);
        let (bridge_tx, client_rx) = tokio::io::duplex(4096);

        let bridge_handle = tokio::spawn(async move {
            run_bridge_streams(port, bridge_rx, bridge_tx).await
        });

        let mut client_tx = client_tx;
        let mut reader = BufReader::new(client_rx);

        // Send initialize through client_tx
        let req = json!({
            "jsonrpc": "2.0",
            "id": 42,
            "method": "initialize",
            "params": {}
        }).to_string() + "\n";

        client_tx.write_all(req.as_bytes()).await.expect("write failed");

        // Read response from client_rx
        let mut line = String::new();
        reader.read_line(&mut line).await.expect("read failed");

        let res: serde_json::Value = serde_json::from_str(&line).expect("valid json");
        assert_eq!(res["jsonrpc"], "2.0");
        assert_eq!(res["id"], 42);
        assert_eq!(res["result"]["serverInfo"]["name"], "liosvideo");

        // Drop client_tx (simulating stdin close)
        drop(client_tx);

        // Bridge should exit cleanly
        let bridge_res = bridge_handle.await.expect("bridge join failed");
        assert!(bridge_res.is_ok());

        server.stop();
    }
}
