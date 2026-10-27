use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::project::ProjectError;

#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    pub default_agent: Option<String>,
    pub project_agents: BTreeMap<String, String>,
    pub custom: Vec<CustomAgent>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// Missing or unreadable settings are the defaults.
pub fn load_settings(file: &Path) -> AgentSettings {
    std::fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_settings(file: &Path, s: &AgentSettings) -> Result<(), ProjectError> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| ProjectError::Other(e.to_string()))?;
    std::fs::write(file, json)?;
    Ok(())
}

/// The project's own choice, else the default agent.
pub fn agent_for_project(s: &AgentSettings, root: &str) -> Option<String> {
    s.project_agents.get(root).cloned().or_else(|| s.default_agent.clone())
}

pub fn validate_custom(c: &CustomAgent, builtin_ids: &[String]) -> Result<(), ProjectError> {
    let bad = |why: &str| Err(ProjectError::Other(format!("Invalid custom agent: {why}")));
    if c.id.trim().is_empty() {
        return bad("id is empty");
    }
    if c.name.trim().is_empty() {
        return bad("name is empty");
    }
    if c.command.trim().is_empty() {
        return bad("command is empty");
    }
    if builtin_ids.contains(&c.id) {
        return bad("id is already used by a built-in agent");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(id: &str, name: &str, command: &str) -> CustomAgent {
        CustomAgent { id: id.into(), name: name.into(), command: command.into(), args: vec![], env: BTreeMap::new() }
    }

    #[test]
    fn settings_roundtrip_and_project_override() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cfg/agents.json");
        assert_eq!(load_settings(&file), AgentSettings::default());
        let mut s = AgentSettings { default_agent: Some("gemini".into()), ..Default::default() };
        s.project_agents.insert("/p/a".into(), "claude".into());
        s.custom.push(custom("my", "Mine", "/bin/my-agent"));
        save_settings(&file, &s).unwrap();
        assert_eq!(load_settings(&file), s);
        assert_eq!(agent_for_project(&s, "/p/a").as_deref(), Some("claude"));
        assert_eq!(agent_for_project(&s, "/p/b").as_deref(), Some("gemini"));
        std::fs::write(&file, "{oops").unwrap();
        assert_eq!(load_settings(&file), AgentSettings::default());
    }

    #[test]
    fn validate_custom_rejects_empty_and_builtin_ids() {
        let builtins = vec!["claude".to_string()];
        assert!(validate_custom(&custom("my", "Mine", "/bin/x"), &builtins).is_ok());
        assert!(validate_custom(&custom("my", " ", "/bin/x"), &builtins).is_err());
        assert!(validate_custom(&custom("my", "Mine", ""), &builtins).is_err());
        assert!(validate_custom(&custom("claude", "Mine", "/bin/x"), &builtins).is_err());
        assert!(validate_custom(&custom("", "Mine", "/bin/x"), &builtins).is_err());
    }
}
