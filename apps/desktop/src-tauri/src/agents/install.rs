use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};

use crate::project::ProjectError;

/// Installs an npm adapter into its own prefix (never globally), streaming npm's output line by line.
pub async fn install_adapter(
    npm: &Path,
    path_env: &str,
    dir: &Path,
    package: &str,
    version: &str,
    mut on_line: impl FnMut(String),
) -> Result<(), ProjectError> {
    std::fs::create_dir_all(dir)?;
    let mut child = tokio::process::Command::new(npm)
        .arg("install")
        .arg("--prefix")
        .arg(dir)
        .args(["--no-audit", "--no-fund", "--loglevel=http", &format!("{package}@{version}")])
        .env("PATH", path_env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let forward = |stream: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>, tx: tokio::sync::mpsc::UnboundedSender<String>| {
        tokio::spawn(async move {
            let Some(stream) = stream else { return };
            let mut lines = BufReader::new(stream).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        })
    };
    let out = forward(child.stdout.take().map(|s| Box::new(s) as _), tx.clone());
    let err = forward(child.stderr.take().map(|s| Box::new(s) as _), tx);
    let mut tail: VecDeque<String> = VecDeque::new();
    while let Some(line) = rx.recv().await {
        if tail.len() == 20 {
            tail.pop_front();
        }
        tail.push_back(line.clone());
        on_line(line);
    }
    let _ = (out.await, err.await);
    let status = child.wait().await?;
    if !status.success() {
        let tail: Vec<String> = tail.into();
        return Err(ProjectError::Other(format!("Adapter install failed ({status}):\n{}", tail.join("\n"))));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::tests::script;

    #[tokio::test]
    async fn install_streams_lines_and_succeeds() {
        let bin = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        // fake npm: `npm install --prefix <dir> ...` → creates the adapter bin
        let npm = script(bin.path(), "npm", r#"echo "fetching $7"; echo done >&2; mkdir -p "$3/node_modules/.bin"; touch "$3/node_modules/.bin/claude-agent-acp""#);
        let mut lines = vec![];
        install_adapter(&npm, "/usr/bin:/bin", dir.path(), "@agentclientprotocol/claude-agent-acp", "0.97.0", |l| lines.push(l)).await.unwrap();
        assert!(lines.contains(&"fetching @agentclientprotocol/claude-agent-acp@0.97.0".to_string()), "{lines:?}");
        assert!(lines.contains(&"done".to_string()));
        assert!(dir.path().join("node_modules/.bin/claude-agent-acp").exists());
    }

    #[tokio::test]
    async fn install_failure_reports_tail() {
        let bin = tempfile::tempdir().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let npm = script(bin.path(), "npm", "echo 'npm error code E404' >&2; exit 1");
        let err = install_adapter(&npm, "/usr/bin:/bin", dir.path(), "@x/y", "1.0.0", |_| {}).await.unwrap_err();
        assert!(err.to_string().contains("E404"), "{err}");
    }
}
