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

    /// Stores the newly connected session, stopping the one it replaces. A session started
    /// for a project that is no longer open (`still_current` false) is stopped instead.
    async fn install(&self, session: Arc<Session>, still_current: bool) -> Result<()> {
        if !still_current {
            session.close();
            return Err(ProjectError::Other("The project changed while the agent was starting".into()));
        }
        if let Some(old) = self.0.lock().await.replace(session) {
            old.close();
        }
        Ok(())
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

/// Passes `r` through, telling the chat when a connect step failed so it doesn't keep showing the old state.
fn reported<T>(events: &Arc<dyn SessionEvents>, agent_id: &str, r: Result<T>) -> Result<T> {
    if let Err(e) = &r {
        events.emit("agent://status", json!({ "state": "error", "agentId": agent_id, "message": e.to_string() }));
    }
    r
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
    let spec = reported(&events, &agent_id, resolve_spec(&app, &agent_id).await)?;
    let session = reported(&events, &agent_id, spawn(&spec, root.clone(), agent_id.clone(), events.clone()))?;
    // resolving the login-shell PATH can take seconds; the project may have been switched meanwhile
    let still_current = project.root().ok().as_ref() == Some(&root);
    sessions.install(session.clone(), still_current).await?;
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
pub async fn agent_set_config_option(
    sessions: State<'_, SessionState>,
    config_id: String,
    value: serde_json::Value,
) -> Result<serde_json::Value> {
    sessions.current().await?.set_config_option(&config_id, value).await
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

    fn fake_session() -> Arc<Session> {
        let (r, w, _agent) = crate::acp::fake::pair();
        Session::connect(r, w, std::env::temp_dir(), "fake".into(), Arc::new(Print))
    }

    #[derive(Default)]
    struct Seen(Mutex<Vec<(String, Value)>>);

    impl SessionEvents for Seen {
        fn emit(&self, event: &str, payload: Value) {
            self.0.lock().unwrap().push((event.into(), payload));
        }
    }

    #[test]
    fn a_failed_connect_step_is_reported_as_an_error_status() {
        let seen = Arc::new(Seen::default());
        let events: Arc<dyn SessionEvents> = seen.clone();
        let r: Result<()> = reported(&events, "gemini", Err(ProjectError::Other("Couldn't start gemini: not found".into())));
        assert!(r.is_err());
        let got = seen.0.lock().unwrap();
        assert_eq!(got[0].0, "agent://status");
        assert_eq!(got[0].1, json!({ "state": "error", "agentId": "gemini", "message": "Couldn't start gemini: not found" }));
    }

    #[tokio::test]
    async fn installing_a_session_closes_the_one_it_replaces() {
        let state = SessionState::default();
        let (first, second) = (fake_session(), fake_session());
        state.install(first.clone(), true).await.unwrap();
        state.install(second.clone(), true).await.unwrap();
        assert!(first.is_closing(), "the overwritten session is stopped, not leaked");
        assert!(!second.is_closing());
        assert!(Arc::ptr_eq(&state.current().await.unwrap(), &second));
    }

    #[tokio::test]
    async fn a_session_for_a_project_no_longer_open_is_closed_not_stored() {
        let state = SessionState::default();
        let stale = fake_session();
        assert!(state.install(stale.clone(), false).await.is_err());
        assert!(stale.is_closing());
        assert!(state.current().await.is_err());
    }
}
