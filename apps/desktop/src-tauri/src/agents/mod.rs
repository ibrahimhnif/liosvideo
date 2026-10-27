pub mod commands;
pub mod install;
pub mod settings;
pub mod shell_path;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentEntry {
    pub id: String,
    pub name: String,
    pub bins: Vec<String>,
    pub launch: Launch,
    pub install_url: Option<String>,
    pub auth_note: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Launch {
    Native { args: Vec<String> },
    Adapter { package: String, version: String, bin: String, args: Vec<String> },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Ready,
    Enable,
    NotInstalled,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: String,
    pub name: String,
    pub state: AgentState,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub install_url: Option<String>,
    pub auth_note: Option<String>,
    pub custom: bool,
}

pub fn builtin_registry() -> Vec<AgentEntry> {
    serde_json::from_str(include_str!("../../agents.json")).expect("agents.json is valid")
}

/// First executable named `name` in a `:`-separated PATH.
pub fn find_bin(name: &str, path: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    path.split(':').filter(|d| !d.is_empty()).map(|d| Path::new(d).join(name)).find(|p| {
        p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    })
}

pub fn adapter_bin(adapters_dir: &Path, entry_id: &str, bin: &str) -> PathBuf {
    adapters_dir.join(entry_id).join("node_modules/.bin").join(bin)
}

/// First line of `<bin> --version`, or None if it fails or takes over 3 s.
async fn version_of(bin: &Path, path: &str) -> Option<String> {
    let run = tokio::process::Command::new(bin)
        .arg("--version")
        .env("PATH", path)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(3), run).await.ok()?.ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
}

async fn detect_one(entry: &AgentEntry, path: &str, adapters_dir: &Path) -> AgentStatus {
    let binary = entry.bins.iter().find_map(|b| find_bin(b, path));
    let version = match &binary {
        Some(b) => version_of(b, path).await,
        None => None,
    };
    let state = match (&binary, &entry.launch) {
        (None, _) => AgentState::NotInstalled,
        (Some(_), Launch::Native { .. }) => AgentState::Ready,
        (Some(_), Launch::Adapter { bin, .. }) => {
            if adapter_bin(adapters_dir, &entry.id, bin).exists() { AgentState::Ready } else { AgentState::Enable }
        }
    };
    AgentStatus {
        id: entry.id.clone(),
        name: entry.name.clone(),
        state,
        binary: binary.map(|b| b.to_string_lossy().into_owned()),
        version,
        install_url: entry.install_url.clone(),
        auth_note: entry.auth_note.clone(),
        custom: false,
    }
}

/// Status of every registry agent, checked concurrently.
pub async fn detect(registry: &[AgentEntry], path: &str, adapters_dir: &Path) -> Vec<AgentStatus> {
    let tasks: Vec<_> = registry
        .iter()
        .cloned()
        .map(|e| {
            let (path, dir) = (path.to_string(), adapters_dir.to_path_buf());
            tokio::spawn(async move { detect_one(&e, &path, &dir).await })
        })
        .collect();
    let mut out = vec![];
    for t in tasks {
        if let Ok(s) = t.await {
            out.push(s);
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaunchSpec {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// How to start an agent in ACP mode: built-in native mode, an installed adapter, or a custom command.
pub fn launch_spec(
    id: &str,
    registry: &[AgentEntry],
    settings: &settings::AgentSettings,
    path_env: &str,
    adapters_dir: &Path,
) -> Result<LaunchSpec, crate::project::ProjectError> {
    use crate::project::ProjectError;
    let path = ("PATH".to_string(), path_env.to_string());
    if let Some(entry) = registry.iter().find(|e| e.id == id) {
        return match &entry.launch {
            Launch::Native { args } => {
                let command = entry.bins.iter().find_map(|b| find_bin(b, path_env));
                let command = command.ok_or_else(|| ProjectError::Other(format!("{} is not installed", entry.name)))?;
                Ok(LaunchSpec { command, args: args.clone(), env: vec![path] })
            }
            Launch::Adapter { bin, args, .. } => {
                let command = adapter_bin(adapters_dir, &entry.id, bin);
                if !command.exists() {
                    return Err(ProjectError::Other(format!("Adapter not installed for {}", entry.name)));
                }
                Ok(LaunchSpec { command, args: args.clone(), env: vec![path] })
            }
        };
    }
    let custom = settings.custom.iter().find(|c| c.id == id).ok_or_else(|| ProjectError::Other(format!("Unknown agent \"{id}\"")))?;
    let command = if custom.command.contains('/') { Some(PathBuf::from(&custom.command)) } else { find_bin(&custom.command, path_env) };
    let command = command.ok_or_else(|| ProjectError::Other(format!("Command \"{}\" not found", custom.command)))?;
    let mut env: Vec<(String, String)> = custom.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    if !custom.env.contains_key("PATH") {
        env.push(path);
    }
    Ok(LaunchSpec { command, args: custom.args.clone(), env })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    pub fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[test]
    fn find_bin_requires_executable() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        fs::write(a.path().join("tool"), "not executable").unwrap();
        let exe = script(b.path(), "tool", "true");
        let path = format!("{}:{}", a.path().display(), b.path().display());
        assert_eq!(find_bin("tool", &path), Some(exe));
        assert_eq!(find_bin("missing", &path), None);
    }

    #[test]
    fn registry_parses_and_has_expected_entries() {
        let r = builtin_registry();
        let ids: Vec<&str> = r.iter().map(|e| e.id.as_str()).collect();
        for id in ["claude", "codex", "gemini"] {
            assert!(ids.contains(&id), "missing {id}");
        }
        let claude = r.iter().find(|e| e.id == "claude").unwrap();
        assert!(matches!(&claude.launch, Launch::Adapter { package, .. } if package == "@agentclientprotocol/claude-agent-acp"));
        let gemini = r.iter().find(|e| e.id == "gemini").unwrap();
        assert_eq!(gemini.launch, Launch::Native { args: vec!["--acp".into()] });
    }

    #[tokio::test]
    async fn detect_reports_states() {
        let bin = tempfile::tempdir().unwrap();
        let adapters = tempfile::tempdir().unwrap();
        script(bin.path(), "gemini", "echo 1.2.3");
        script(bin.path(), "claude", "echo '1.2.3 (Claude Code)'");
        let path = bin.path().to_string_lossy().into_owned();
        let r = builtin_registry();
        let state = |list: &[AgentStatus], id: &str| list.iter().find(|s| s.id == id).unwrap().clone();
        let list = detect(&r, &path, adapters.path()).await;
        assert_eq!(state(&list, "gemini").state, AgentState::Ready);
        assert_eq!(state(&list, "gemini").version.as_deref(), Some("1.2.3"));
        assert_eq!(state(&list, "claude").state, AgentState::Enable);
        assert_eq!(state(&list, "codex").state, AgentState::NotInstalled);
        let adapter = adapter_bin(adapters.path(), "claude", "claude-agent-acp");
        fs::create_dir_all(adapter.parent().unwrap()).unwrap();
        script(adapter.parent().unwrap(), "claude-agent-acp", "true");
        let list = detect(&r, &path, adapters.path()).await;
        assert_eq!(state(&list, "claude").state, AgentState::Ready);
    }

    #[test]
    fn launch_spec_for_native_adapter_and_custom() {
        let bin = tempfile::tempdir().unwrap();
        let adapters = tempfile::tempdir().unwrap();
        let gemini = script(bin.path(), "gemini", "true");
        let path = bin.path().to_string_lossy().into_owned();
        let r = builtin_registry();
        let mut s = settings::AgentSettings::default();
        let has_path = |spec: &LaunchSpec| spec.env.iter().any(|(k, v)| k == "PATH" && v == &path);

        let spec = launch_spec("gemini", &r, &s, &path, adapters.path()).unwrap();
        assert_eq!(spec.command, gemini);
        assert_eq!(spec.args, vec!["--acp"]);
        assert!(has_path(&spec));

        assert!(launch_spec("claude", &r, &s, &path, adapters.path()).unwrap_err().to_string().contains("Adapter not installed"));
        let adapter = adapter_bin(adapters.path(), "claude", "claude-agent-acp");
        fs::create_dir_all(adapter.parent().unwrap()).unwrap();
        script(adapter.parent().unwrap(), "claude-agent-acp", "true");
        let spec = launch_spec("claude", &r, &s, &path, adapters.path()).unwrap();
        assert_eq!(spec.command, adapter);
        assert!(has_path(&spec));

        let mut env = std::collections::BTreeMap::new();
        env.insert("TOKEN_FILE".to_string(), "/x".to_string());
        s.custom.push(settings::CustomAgent { id: "mine".into(), name: "Mine".into(), command: "gemini".into(), args: vec!["--acp".into(), "-v".into()], env });
        let spec = launch_spec("mine", &r, &s, &path, adapters.path()).unwrap();
        assert_eq!(spec.command, gemini);
        assert_eq!(spec.args, vec!["--acp", "-v"]);
        assert!(spec.env.contains(&("TOKEN_FILE".to_string(), "/x".to_string())));
        assert!(has_path(&spec));

        assert!(launch_spec("nope", &r, &s, &path, adapters.path()).is_err());
    }
}
