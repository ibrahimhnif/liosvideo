use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use super::session::{SelectionContext, Session, SessionEvents};
use crate::agents::{self, builtin_registry, launch_spec, shell_path, LaunchSpec};
use crate::project::{ProjectError, ProjectState};

type Result<T> = std::result::Result<T, ProjectError>;

const STDERR_TAIL: usize = 20;

/// The agent session of the open project, if connected.
#[derive(Default)]
pub struct SessionState(tokio::sync::Mutex<Option<Arc<Session>>>);

impl SessionState {
    pub async fn close(&self) {
        if let Some(s) = self.0.lock().await.take() {
            s.close();
        }
    }

    async fn current(&self) -> Result<Arc<Session>> {
        self.0.lock().await.clone().ok_or_else(|| ProjectError::Other("No agent is connected".into()))
    }
}

struct TauriEvents(AppHandle);

impl SessionEvents for TauriEvents {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.0.emit(event, payload);
    }
}

/// Starts the agent process in the project folder and wires its stdio to a session.
/// When the process ends on its own, an `exited` status carries the tail of its stderr.
pub fn spawn(spec: &LaunchSpec, root: PathBuf, agent_id: String, events: Arc<dyn SessionEvents>) -> Result<Arc<Session>> {
    let mut child = tokio::process::Command::new(&spec.command)
        .args(&spec.args)
        .envs(spec.env.iter().cloned())
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| ProjectError::Other(format!("Couldn't start {}: {e}", spec.command.display())))?;
    let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
        return Err(ProjectError::Other("agent stdio unavailable".into()));
    };
    let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let tail_w = tail.clone();
    let stderr_done = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            let mut t = tail_w.lock().unwrap();
            if t.len() == STDERR_TAIL {
                t.pop_front();
            }
            t.push_back(l);
        }
    });
    let session = Session::connect(stdout, stdin, root, agent_id, events);
    *session.child.lock().unwrap() = Some(child);
    let watch = session.clone();
    tokio::spawn(async move {
        watch.connection().closed().await;
        let _ = tokio::time::timeout(std::time::Duration::from_millis(500), stderr_done).await;
        if !watch.is_closing() {
            let message = tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n");
            watch.status("exited", json!({ "message": if message.is_empty() { "The agent exited".to_string() } else { message } }));
        }
    });
    Ok(session)
}

async fn resolve_spec(app: &AppHandle, agent_id: &str) -> Result<LaunchSpec> {
    let path = shell_path::login_path().await;
    let settings = agents::commands::load(app)?;
    launch_spec(agent_id, &builtin_registry(), &settings, &path, &agents::commands::adapters_dir(app)?)
}

#[tauri::command]
pub async fn agent_connect(
    app: AppHandle,
    project: State<'_, ProjectState>,
    sessions: State<'_, SessionState>,
    agent_id: Option<String>,
) -> Result<()> {
    let root = project.root()?;
    let agent_id = match agent_id {
        Some(id) => id,
        None => agents::settings::agent_for_project(&agents::commands::load(&app)?, &root.to_string_lossy())
            .ok_or_else(|| ProjectError::Other("Choose an agent first".into()))?,
    };
    sessions.close().await;
    let events: Arc<dyn SessionEvents> = Arc::new(TauriEvents(app.clone()));
    let spec = match resolve_spec(&app, &agent_id).await {
        Ok(spec) => spec,
        Err(e) => {
            events.emit("agent://status", json!({ "state": "error", "agentId": agent_id, "message": e.to_string() }));
            return Err(e);
        }
    };
    let session = spawn(&spec, root, agent_id, events)?;
    *sessions.0.lock().await = Some(session.clone());
    session.start().await
}

#[tauri::command]
pub async fn agent_authenticate(sessions: State<'_, SessionState>, method_id: String) -> Result<()> {
    sessions.current().await?.authenticate(&method_id).await
}

#[tauri::command]
pub async fn agent_prompt(sessions: State<'_, SessionState>, text: String, selection: Option<SelectionContext>) -> Result<String> {
    // the lock is released before the turn runs, so cancel and permission answers get through
    let session = sessions.current().await?;
    session.prompt(&text, selection.as_ref()).await
}

#[tauri::command]
pub async fn agent_cancel(sessions: State<'_, SessionState>) -> Result<()> {
    sessions.current().await?.cancel().await;
    Ok(())
}

#[tauri::command]
pub async fn agent_permission_respond(sessions: State<'_, SessionState>, request_id: String, option_id: Option<String>) -> Result<()> {
    sessions.current().await?.respond(&request_id, option_id);
    Ok(())
}

#[tauri::command]
pub async fn agent_disconnect(sessions: State<'_, SessionState>) -> Result<()> {
    sessions.close().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Print;

    impl SessionEvents for Print {
        fn emit(&self, event: &str, payload: Value) {
            println!("{event} {payload}");
        }
    }

    /// Manual check against a real agent: `LIOSVIDEO_AGENT_SMOKE=gemini LIOSVIDEO_AGENT_PROJECT=<dir> cargo test real_agent_smoke -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn real_agent_smoke() {
        let id = std::env::var("LIOSVIDEO_AGENT_SMOKE").expect("LIOSVIDEO_AGENT_SMOKE");
        let root = PathBuf::from(std::env::var("LIOSVIDEO_AGENT_PROJECT").expect("LIOSVIDEO_AGENT_PROJECT")).canonicalize().unwrap();
        let adapters = std::env::var("LIOSVIDEO_ADAPTERS_DIR").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        let path = shell_path::login_path().await;
        let spec = launch_spec(&id, &builtin_registry(), &Default::default(), &path, &adapters).unwrap();
        println!("launch {} {:?}", spec.command.display(), spec.args);
        let session = spawn(&spec, root, id, Arc::new(Print)).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(60), session.start()).await.expect("start timed out").unwrap();
        session.close();
    }
}
