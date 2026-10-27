use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::recent;
use crate::git::{self, CommitInfo, FileDiff, HistoryStatus};

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("no project is open")]
    NotOpen,
    #[error("path \"{0}\" is outside the project")]
    Outside(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for ProjectError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, ProjectError>;

/// Resolves a project-relative path, rejecting anything that could land outside `root`
/// (absolute paths, `..` escapes, symlinks pointing out).
pub fn resolve_in_project(root: &Path, rel: &str) -> Result<PathBuf> {
    let outside = || ProjectError::Outside(rel.to_string());
    let mut normalized = PathBuf::new();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(outside());
                }
            }
            Component::RootDir | Component::Prefix(_) => return Err(outside()),
        }
    }
    let root = root.canonicalize()?;
    let joined = root.join(&normalized);
    // Canonicalize the deepest existing ancestor so symlinks are resolved even for new files.
    let mut existing = joined.as_path();
    while !existing.exists() {
        existing = existing.parent().ok_or_else(outside)?;
    }
    if !existing.canonicalize()?.starts_with(&root) {
        return Err(outside());
    }
    Ok(joined)
}

pub fn list_compositions_in(root: &Path) -> Result<Vec<String>> {
    let mut names: Vec<String> = fs::read_dir(root)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".ts") && !n.ends_with(".d.ts"))
        .collect();
    names.sort();
    Ok(names)
}

pub fn read_file_in(root: &Path, rel: &str) -> Result<String> {
    Ok(fs::read_to_string(resolve_in_project(root, rel)?)?)
}

/// Project-relative paths whose changes never affect rendering.
pub fn is_ignored(rel: &str) -> bool {
    const IGNORED: [&str; 4] = [".git/", "out/", ".liosvideo/cache/", "node_modules/"];
    IGNORED.iter().any(|prefix| rel.starts_with(prefix) || rel.contains(&format!("/{prefix}")))
}

struct OpenProject {
    root: PathBuf,
    _watcher: crate::watch::Watcher,
}

#[derive(Default)]
pub struct ProjectState(Mutex<Option<OpenProject>>);

impl ProjectState {
    fn root(&self) -> Result<PathBuf> {
        self.0.lock().unwrap().as_ref().map(|p| p.root.clone()).ok_or(ProjectError::NotOpen)
    }
}

#[derive(Serialize)]
pub struct ProjectInfo {
    root: String,
    compositions: Vec<String>,
    history: HistoryStatus,
}

fn emit_committed(app: &AppHandle, commit: &CommitInfo) {
    let _ = app.emit("project://committed", commit);
}

fn recent_file(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_config_dir().map_err(|e| ProjectError::Other(e.to_string()))?.join("recent.json"))
}

fn open_at(app: &AppHandle, state: &ProjectState, root: &Path) -> Result<ProjectInfo> {
    let (root, history, commit) = prepare_open(root)?;
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| ProjectError::Other(e.to_string()))?;
    let watcher = crate::watch::start(app.clone(), root.clone()).map_err(|e| ProjectError::Other(e.to_string()))?;
    let compositions = list_compositions_in(&root)?;
    *state.0.lock().unwrap() = Some(OpenProject { root: root.clone(), _watcher: watcher });
    if let Some(c) = &commit {
        emit_committed(app, c);
    }
    let root_str = root.to_string_lossy().into_owned();
    if let Ok(file) = recent_file(app) {
        let _ = recent::save_recent(&file, &recent::push_recent(recent::load_recent(&file), &root_str));
    }
    Ok(ProjectInfo { root: root_str, compositions, history })
}

#[tauri::command]
pub fn open_project(app: AppHandle, state: State<ProjectState>, root: String) -> Result<ProjectInfo> {
    open_at(&app, &state, Path::new(&root))
}

#[tauri::command]
pub fn create_project(app: AppHandle, state: State<ProjectState>, parent: String, name: String) -> Result<ProjectInfo> {
    let root = crate::scaffold::create_project_in(Path::new(&parent), &name)?;
    open_at(&app, &state, &root)
}

#[tauri::command]
pub fn recent_projects(app: AppHandle) -> Result<Vec<String>> {
    Ok(recent::load_recent(&recent_file(&app)?))
}

#[tauri::command]
pub fn enable_history(app: AppHandle, state: State<ProjectState>) -> Result<HistoryStatus> {
    let root = state.root()?;
    let commit = git::enable_history(&root)?;
    emit_committed(&app, &commit);
    Ok(git::history_status(&root))
}

/// Root of the open project, only when the app manages its history.
fn history_root(state: &ProjectState) -> Result<PathBuf> {
    let root = state.root()?;
    if git::history_status(&root) != HistoryStatus::Enabled {
        return Err(ProjectError::Other("History is not enabled for this project".into()));
    }
    Ok(root)
}

#[tauri::command]
pub fn project_history(state: State<ProjectState>, limit: usize) -> Result<Vec<CommitInfo>> {
    git::history(&history_root(&state)?, limit)
}

#[tauri::command]
pub fn commit_diff(state: State<ProjectState>, id: String) -> Result<Vec<FileDiff>> {
    git::commit_diff(&history_root(&state)?, &id)
}

#[tauri::command]
pub fn checkpoint(app: AppHandle, state: State<ProjectState>, message: String) -> Result<Option<CommitInfo>> {
    let message = if message.trim().is_empty() { "Checkpoint" } else { message.trim() };
    let commit = git::commit_all(&history_root(&state)?, message)?;
    if let Some(c) = &commit {
        emit_committed(&app, c);
    }
    Ok(commit)
}

#[tauri::command]
pub fn restore_commit(app: AppHandle, state: State<ProjectState>, id: String) -> Result<CommitInfo> {
    let commit = git::restore(&history_root(&state)?, &id)?;
    emit_committed(&app, &commit);
    Ok(commit)
}

#[tauri::command]
pub fn list_compositions(state: State<ProjectState>) -> Result<Vec<String>> {
    list_compositions_in(&state.root()?)
}

#[tauri::command]
pub fn read_project_file(state: State<ProjectState>, rel: String) -> Result<String> {
    read_file_in(&state.root()?, &rel)
}

/// Absolute path of a project asset, for `convertFileSrc` on the JS side.
#[tauri::command]
pub fn asset_url_path(state: State<ProjectState>, rel: String) -> Result<String> {
    Ok(resolve_in_project(&state.root()?, &rel)?.to_string_lossy().into_owned())
}

/// The non-Tauri part of opening: canonical root, history status, and a "Manual edit" commit for pending changes.
pub fn prepare_open(root: &Path) -> Result<(PathBuf, HistoryStatus, Option<CommitInfo>)> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(ProjectError::Other(format!("{} is not a folder", root.display())));
    }
    let status = git::history_status(&root);
    let commit = if status == HistoryStatus::Enabled { git::commit_all(&root, git::MANUAL_EDIT)? } else { None };
    Ok((root, status, commit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        for f in ["long.ts", "short.ts", "types.d.ts", "scenes/a.ts", "scenes/intro.ts"] {
            fs::write(dir.path().join(f), "export {}").unwrap();
        }
        dir
    }

    #[test]
    fn resolves_paths_inside_the_project() {
        let dir = project();
        let p = resolve_in_project(dir.path(), "scenes/a.ts").unwrap();
        assert!(p.ends_with("scenes/a.ts"));
    }

    #[test]
    fn rejects_parent_escapes() {
        let dir = project();
        assert!(resolve_in_project(dir.path(), "../x").is_err());
        assert!(resolve_in_project(dir.path(), "scenes/../../x").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        let dir = project();
        assert!(resolve_in_project(dir.path(), "/etc/passwd").is_err());
    }

    #[test]
    fn rejects_symlinks_leading_outside() {
        let dir = project();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("f"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        assert!(resolve_in_project(dir.path(), "link/f").is_err());
    }

    #[test]
    fn allows_paths_that_do_not_exist_yet() {
        let dir = project();
        assert!(resolve_in_project(dir.path(), "assets/new.png").is_ok());
    }

    #[test]
    fn lists_root_compositions_only() {
        let dir = project();
        assert_eq!(list_compositions_in(dir.path()).unwrap(), vec!["long.ts", "short.ts"]);
    }

    #[test]
    fn reads_project_files() {
        let dir = project();
        assert_eq!(read_file_in(dir.path(), "scenes/a.ts").unwrap(), "export {}");
        assert!(read_file_in(dir.path(), "../outside").is_err());
    }

    #[test]
    fn ignores_internal_directories_for_change_events() {
        assert!(is_ignored("node_modules/x/index.js"));
        assert!(is_ignored(".git/HEAD"));
        assert!(is_ignored("out/long.mp4"));
        assert!(is_ignored(".liosvideo/cache/a"));
        assert!(!is_ignored("scenes/a.ts"));
        assert!(!is_ignored(".liosvideo/project.json"));
    }

    #[test]
    fn open_inits_nothing_in_plain_folder() {
        let dir = project();
        let (_, status, commit) = prepare_open(dir.path()).unwrap();
        assert_eq!(status, HistoryStatus::Off);
        assert!(commit.is_none());
        assert!(!dir.path().join(".git").exists());
    }

    #[test]
    fn open_commits_pending_edits_as_manual_edit() {
        let dir = project();
        crate::git::enable_history(dir.path()).unwrap();
        fs::write(dir.path().join("scenes/a.ts"), "export const edited = 1;").unwrap();
        let (_, status, commit) = prepare_open(dir.path()).unwrap();
        assert_eq!(status, HistoryStatus::Enabled);
        assert_eq!(commit.unwrap().summary, crate::git::MANUAL_EDIT);
        let (_, _, again) = prepare_open(dir.path()).unwrap();
        assert!(again.is_none());
    }
}
