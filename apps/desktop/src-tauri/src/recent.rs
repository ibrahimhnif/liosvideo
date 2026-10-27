use std::fs;
use std::path::Path;

use crate::project::ProjectError;

pub const MAX_RECENT: usize = 10;

/// Most recent first, without duplicates, at most `MAX_RECENT`.
pub fn push_recent(list: Vec<String>, root: &str) -> Vec<String> {
    let mut out = vec![root.to_string()];
    out.extend(list.into_iter().filter(|p| p != root));
    out.truncate(MAX_RECENT);
    out
}

/// A missing or unreadable file is an empty list; folders that no longer exist are dropped.
pub fn load_recent(file: &Path) -> Vec<String> {
    let list: Vec<String> = fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    list.into_iter().filter(|p| Path::new(p).is_dir()).collect()
}

pub fn save_recent(file: &Path, list: &[String]) -> std::result::Result<(), ProjectError> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(file, serde_json::to_string_pretty(list).map_err(|e| ProjectError::Other(e.to_string()))?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn push_recent_moves_existing_to_front_and_caps() {
        let list: Vec<String> = (0..MAX_RECENT).map(|i| format!("/p{i}")).collect();
        let list = push_recent(list, "/p3");
        assert_eq!(list[0], "/p3");
        assert_eq!(list.iter().filter(|p| *p == "/p3").count(), 1);
        assert_eq!(list.len(), MAX_RECENT);
        let list = push_recent(list, "/new");
        assert_eq!(list[0], "/new");
        assert_eq!(list.len(), MAX_RECENT);
        assert!(!list.contains(&"/p9".to_string()), "oldest dropped");
    }

    #[test]
    fn load_recent_drops_missing_folders_and_survives_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("recent.json");
        assert!(load_recent(&file).is_empty());
        let live = dir.path().to_string_lossy().into_owned();
        save_recent(&file, &[live.clone(), "/definitely/not/here".into()]).unwrap();
        assert_eq!(load_recent(&file), vec![live]);
        fs::write(&file, "{not json").unwrap();
        assert!(load_recent(&file).is_empty());
    }
}
