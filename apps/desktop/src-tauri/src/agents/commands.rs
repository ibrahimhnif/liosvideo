use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::settings::{self, AgentSettings, CustomAgent};
use super::{builtin_registry, detect, find_bin, shell_path, AgentState, AgentStatus, Launch};
use crate::project::{ProjectError, ProjectState};

type Result<T> = std::result::Result<T, ProjectError>;

fn config_file(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir().map_err(|e| ProjectError::Other(e.to_string()))?.join("agents.json"))
}

pub fn adapters_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| ProjectError::Other(e.to_string()))?.join("adapters"))
}

pub fn load(app: &AppHandle) -> Result<AgentSettings> {
    Ok(settings::load_settings(&config_file(app)?))
}

fn update(app: &AppHandle, f: impl FnOnce(&mut AgentSettings) -> Result<()>) -> Result<AgentSettings> {
    let file = config_file(app)?;
    let mut s = settings::load_settings(&file);
    f(&mut s)?;
    settings::save_settings(&file, &s)?;
    Ok(s)
}

fn custom_status(c: &CustomAgent, path: &str) -> AgentStatus {
    let binary = if c.command.contains('/') { Some(PathBuf::from(&c.command)).filter(|p| p.exists()) } else { find_bin(&c.command, path) };
    AgentStatus {
        id: c.id.clone(),
        name: c.name.clone(),
        state: if binary.is_some() { AgentState::Ready } else { AgentState::NotInstalled },
        binary: binary.map(|b| b.to_string_lossy().into_owned()),
        version: None,
        install_url: None,
        auth_note: None,
        custom: true,
    }
}

#[tauri::command]
pub async fn list_agents(app: AppHandle) -> Result<Vec<AgentStatus>> {
    let path = shell_path::login_path().await;
    let mut list = detect(&builtin_registry(), &path, &adapters_dir(&app)?).await;
    list.extend(load(&app)?.custom.iter().map(|c| custom_status(c, &path)));
    Ok(list)
}

#[tauri::command]
pub async fn rescan_agents(app: AppHandle) -> Result<Vec<AgentStatus>> {
    shell_path::invalidate().await;
    list_agents(app).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallEvent {
    id: String,
    line: Option<String>,
    done: bool,
    error: Option<String>,
}

#[tauri::command]
pub async fn install_agent_adapter(app: AppHandle, id: String) -> Result<()> {
    let entry = builtin_registry().into_iter().find(|e| e.id == id).ok_or_else(|| ProjectError::Other(format!("Unknown agent \"{id}\"")))?;
    let Launch::Adapter { package, version, .. } = &entry.launch else {
        return Err(ProjectError::Other(format!("{} needs no adapter", entry.name)));
    };
    let path = shell_path::login_path().await;
    let npm = find_bin("npm", &path).ok_or_else(|| ProjectError::Other("npm was not found. Install Node.js to set up this adapter.".into()))?;
    let emit = |line: Option<String>, done: bool, error: Option<String>| {
        let _ = app.emit("agents://install", InstallEvent { id: id.clone(), line, done, error });
    };
    let result = super::install::install_adapter(&npm, &path, &adapters_dir(&app)?.join(&id), package, version, |l| emit(Some(l), false, None)).await;
    match &result {
        Ok(()) => emit(None, true, None),
        Err(e) => emit(None, true, Some(e.to_string())),
    }
    result
}

#[tauri::command]
pub fn get_agent_settings(app: AppHandle) -> Result<AgentSettings> {
    load(&app)
}

#[tauri::command]
pub fn set_default_agent(app: AppHandle, id: String) -> Result<AgentSettings> {
    update(&app, |s| Ok(s.default_agent = Some(id)))
}

#[tauri::command]
pub fn set_project_agent(app: AppHandle, state: State<ProjectState>, id: String) -> Result<AgentSettings> {
    let root = state.root_string()?;
    update(&app, |s| Ok(drop(s.project_agents.insert(root, id))))
}

#[tauri::command]
pub fn add_custom_agent(app: AppHandle, agent: CustomAgent) -> Result<AgentSettings> {
    let builtin: Vec<String> = builtin_registry().into_iter().map(|e| e.id).collect();
    settings::validate_custom(&agent, &builtin)?;
    update(&app, |s| {
        s.custom.retain(|c| c.id != agent.id);
        s.custom.push(agent);
        Ok(())
    })
}

#[tauri::command]
pub fn remove_custom_agent(app: AppHandle, id: String) -> Result<AgentSettings> {
    update(&app, |s| Ok(s.custom.retain(|c| c.id != id)))
}
