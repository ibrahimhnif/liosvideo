use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::recent;
use crate::git::{self, CommitInfo, FileDiff, HistoryStatus};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditorSelection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayheadState {
    pub frame: u32,
    pub fps: f64,
    pub time_seconds: f64,
}

impl Default for PlayheadState {
    fn default() -> Self {
        Self {
            frame: 0,
            fps: 30.0,
            time_seconds: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EditorErrors {
    pub compile: Vec<String>,
    pub runtime: Vec<String>,
}

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
    // A dangling symlink counts as existing; it can't be canonicalized, so it is refused
    // rather than letting a write follow it out of the project.
    let mut existing = joined.as_path();
    while existing.symlink_metadata().is_err() {
        existing = existing.parent().ok_or_else(outside)?;
    }
    if !existing.canonicalize().map_err(|_| outside())?.starts_with(&root) {
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
    _watcher: Option<crate::watch::Watcher>,
}

#[derive(Default, Clone)]
pub struct ProjectState {
    inner: Arc<Mutex<Option<OpenProject>>>,
    selection: Arc<Mutex<Option<EditorSelection>>>,
    playhead: Arc<Mutex<PlayheadState>>,
    errors: Arc<Mutex<EditorErrors>>,
    active_composition: Arc<Mutex<Option<String>>>,
    manifests: Arc<Mutex<HashMap<String, serde_json::Value>>>,
}

impl ProjectState {
    pub fn root_string(&self) -> Result<String> {
        Ok(self.root()?.to_string_lossy().into_owned())
    }

    pub fn root(&self) -> Result<PathBuf> {
        self.inner.lock().unwrap().as_ref().map(|p| p.root.clone()).ok_or(ProjectError::NotOpen)
    }

    pub fn open_for_test(&self, root: PathBuf) {
        *self.inner.lock().unwrap() = Some(OpenProject {
            root,
            _watcher: None,
        });
    }

    pub fn selection(&self) -> Option<EditorSelection> {
        self.selection.lock().unwrap().clone()
    }

    pub fn set_selection(&self, sel: Option<EditorSelection>) {
        *self.selection.lock().unwrap() = sel;
    }

    pub fn playhead(&self) -> PlayheadState {
        self.playhead.lock().unwrap().clone()
    }

    pub fn set_playhead(&self, playhead: PlayheadState) {
        *self.playhead.lock().unwrap() = playhead;
    }

    pub fn errors(&self) -> EditorErrors {
        self.errors.lock().unwrap().clone()
    }

    pub fn set_errors(&self, errors: EditorErrors) {
        *self.errors.lock().unwrap() = errors;
    }

    pub fn active_composition(&self) -> Option<String> {
        self.active_composition.lock().unwrap().clone()
    }

    pub fn set_active_composition(&self, comp: Option<String>) {
        *self.active_composition.lock().unwrap() = comp;
    }

    pub fn manifest(&self, composition: Option<&str>) -> Option<serde_json::Value> {
        let manifests = self.manifests.lock().unwrap();
        if let Some(comp) = composition {
            manifests.get(comp).cloned()
        } else if let Some(active) = self.active_composition() {
            manifests.get(&active).cloned().or_else(|| manifests.values().next().cloned())
        } else {
            manifests.values().next().cloned()
        }
    }

    pub fn set_manifest(&self, composition: String, manifest: serde_json::Value) {
        self.manifests.lock().unwrap().insert(composition, manifest);
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

static GIT_LOCK: Mutex<()> = Mutex::new(());

/// Runs git work on a blocking thread (never the main thread, which would freeze the window),
/// one job at a time so checkpoint, restore and open can't interleave.
pub async fn git_job<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = GIT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        f()
    })
    .await
    .map_err(|e| ProjectError::Other(e.to_string()))?
}

async fn open_at(app: &AppHandle, state: &ProjectState, root: PathBuf) -> Result<ProjectInfo> {
    // the agent session belongs to the previous project
    if let Some(sessions) = app.try_state::<crate::acp::commands::SessionState>() {
        sessions.close().await;
    }
    let (root, history, commit) = git_job(move || prepare_open(&root)).await?;
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| ProjectError::Other(e.to_string()))?;
    let watcher = crate::watch::start(app.clone(), root.clone()).map_err(|e| ProjectError::Other(e.to_string()))?;
    let compositions = list_compositions_in(&root)?;
    *state.inner.lock().unwrap() = Some(OpenProject { root: root.clone(), _watcher: Some(watcher) });
    if let Some(c) = &commit {
        emit_committed(app, c);
    }
    let root_str = root.to_string_lossy().into_owned();
    if let Ok(file) = recent_file(app) {
        let _ = recent::save_recent(&file, &recent::push_recent(recent::load_recent(&file), &root_str));
    }
    Ok(ProjectInfo { root: root_str, compositions, history })
}

fn percent_decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut bytes = input.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let h1 = bytes.next();
            let h2 = bytes.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                if let Ok(hex_str) = std::str::from_utf8(&[h1, h2]) {
                    if let Ok(byte_val) = u8::from_str_radix(hex_str, 16) {
                        out.push(byte_val as char);
                        continue;
                    }
                }
                out.push('%');
                out.push(h1 as char);
                out.push(h2 as char);
            } else {
                out.push('%');
                if let Some(h1) = h1 {
                    out.push(h1 as char);
                }
            }
        } else {
            out.push(b as char);
        }
    }
    out
}

pub fn normalize_project_path(raw: &str) -> PathBuf {
    let mut cleaned = raw.trim().to_string();
    if cleaned.starts_with("file://") {
        cleaned = cleaned[7..].to_string();
    }
    if cleaned.contains('%') {
        cleaned = percent_decode(&cleaned);
    }
    #[cfg(unix)]
    if !cleaned.starts_with('/') && (cleaned.starts_with("Users/") || cleaned.starts_with("home/")) {
        cleaned = format!("/{cleaned}");
    }
    PathBuf::from(cleaned)
}

#[tauri::command]
pub async fn open_project(app: AppHandle, state: State<'_, ProjectState>, root: String) -> Result<ProjectInfo> {
    let root = normalize_project_path(&root);
    open_at(&app, &state, root).await
}

#[tauri::command]
pub async fn close_project(app: AppHandle, state: State<'_, ProjectState>) -> Result<()> {
    if let Some(sessions) = app.try_state::<crate::acp::commands::SessionState>() {
        sessions.close().await;
    }
    *state.inner.lock().unwrap() = None;
    *state.selection.lock().unwrap() = None;
    *state.errors.lock().unwrap() = Default::default();
    *state.active_composition.lock().unwrap() = None;
    state.manifests.lock().unwrap().clear();
    let _ = app.emit("project://closed", ());
    Ok(())
}

#[tauri::command]
pub async fn create_project(app: AppHandle, state: State<'_, ProjectState>, parent: String, name: String) -> Result<ProjectInfo> {
    let root = git_job(move || crate::scaffold::create_project_in(Path::new(&parent), &name)).await?;
    open_at(&app, &state, root).await
}

#[tauri::command]
pub fn recent_projects(app: AppHandle) -> Result<Vec<String>> {
    Ok(recent::load_recent(&recent_file(&app)?))
}

#[tauri::command]
pub async fn enable_history(app: AppHandle, state: State<'_, ProjectState>) -> Result<HistoryStatus> {
    let root = state.root()?;
    let (commit, status) = git_job(move || Ok((git::enable_history(&root)?, git::history_status(&root)))).await?;
    emit_committed(&app, &commit);
    Ok(status)
}

/// Errors unless the app manages this project's history.
fn history_root(root: &Path) -> Result<()> {
    if git::history_status(root) != HistoryStatus::Enabled {
        return Err(ProjectError::Other("History is not enabled for this project".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn project_history(state: State<'_, ProjectState>, limit: usize) -> Result<Vec<CommitInfo>> {
    let root = state.root()?;
    git_job(move || {
        history_root(&root)?;
        git::history(&root, limit)
    })
    .await
}

#[tauri::command]
pub async fn commit_diff(state: State<'_, ProjectState>, id: String) -> Result<Vec<FileDiff>> {
    let root = state.root()?;
    git_job(move || {
        history_root(&root)?;
        git::commit_diff(&root, &id)
    })
    .await
}

#[tauri::command]
pub async fn checkpoint(app: AppHandle, state: State<'_, ProjectState>, message: String) -> Result<Option<CommitInfo>> {
    let root = state.root()?;
    let message = if message.trim().is_empty() { "Checkpoint".to_string() } else { message.trim().to_string() };
    let commit = git_job(move || {
        history_root(&root)?;
        git::commit_all(&root, &message)
    })
    .await?;
    if let Some(c) = &commit {
        emit_committed(&app, c);
    }
    Ok(commit)
}

#[tauri::command]
pub async fn restore_commit(app: AppHandle, state: State<'_, ProjectState>, id: String) -> Result<CommitInfo> {
    let root = state.root()?;
    let commit = git_job(move || {
        history_root(&root)?;
        git::restore(&root, &id)
    })
    .await?;
    emit_committed(&app, &commit);
    Ok(commit)
}

#[tauri::command]
pub async fn revert_commit_files(app: AppHandle, state: State<'_, ProjectState>, id: String, paths: Vec<String>) -> Result<CommitInfo> {
    let root = state.root()?;
    let commit = git_job(move || {
        history_root(&root)?;
        git::revert_files(&root, &id, &paths)
    })
    .await?;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TtsItemStat {
    pub line_id: String,
    pub provider: String,
    pub voice: String,
    pub characters: usize,
    pub cost_usd: f64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TtsStats {
    pub total_characters: usize,
    pub total_cost_usd: f64,
    pub items: Vec<TtsItemStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenStats {
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub total_tokens: usize,
    pub total_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub tts: TtsStats,
    pub tokens: TokenStats,
    pub total_cost_usd: f64,
}

pub fn stats_file(root: &Path) -> PathBuf {
    root.join(".liosvideo").join("stats.json")
}

pub fn conversation_file(root: &Path) -> PathBuf {
    root.join(".liosvideo").join("conversation.json")
}

pub fn load_stats_in(root: &Path) -> ProjectStats {
    let path = stats_file(root);
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(stats) = serde_json::from_str::<ProjectStats>(&content) {
            return stats;
        }
    }
    ProjectStats::default()
}

pub fn save_stats_in(root: &Path, stats: &ProjectStats) -> Result<()> {
    let lios_dir = root.join(".liosvideo");
    let _ = fs::create_dir_all(&lios_dir);
    let content = serde_json::to_string_pretty(stats).map_err(|e| ProjectError::Other(e.to_string()))?;
    fs::write(stats_file(root), content)?;
    Ok(())
}

pub fn record_tts_usage_in(
    root: &Path,
    line_id: &str,
    provider: &str,
    voice: &str,
    text: &str,
) -> Result<ProjectStats> {
    let mut stats = load_stats_in(root);
    let chars = text.chars().count();
    let cost = if provider.to_lowercase().contains("eleven") {
        (chars as f64) * 0.0003
    } else if provider.to_lowercase().contains("google") {
        if voice.contains("Standard") {
            (chars as f64) * 0.000004
        } else {
            (chars as f64) * 0.000016
        }
    } else {
        0.0
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    stats.tts.total_characters += chars;
    stats.tts.total_cost_usd = ((stats.tts.total_cost_usd + cost) * 100000.0).round() / 100000.0;
    stats.tts.items.push(TtsItemStat {
        line_id: line_id.to_string(),
        provider: provider.to_string(),
        voice: voice.to_string(),
        characters: chars,
        cost_usd: (cost * 100000.0).round() / 100000.0,
        timestamp: now,
    });
    stats.total_cost_usd = ((stats.tts.total_cost_usd + stats.tokens.total_cost_usd) * 100000.0).round() / 100000.0;
    save_stats_in(root, &stats)?;
    Ok(stats)
}

pub fn record_token_usage_in(
    root: &Path,
    input_tokens: usize,
    output_tokens: usize,
    model: Option<&str>,
) -> Result<ProjectStats> {
    let mut stats = load_stats_in(root);
    let m = model.unwrap_or("default").to_lowercase();
    let (in_rate, out_rate) = if m.contains("opus") {
        (15.0 / 1_000_000.0, 75.0 / 1_000_000.0)
    } else if m.contains("flash") {
        (0.10 / 1_000_000.0, 0.40 / 1_000_000.0)
    } else {
        (3.0 / 1_000_000.0, 15.0 / 1_000_000.0)
    };

    let cost = (input_tokens as f64 * in_rate) + (output_tokens as f64 * out_rate);
    stats.tokens.input_tokens += input_tokens;
    stats.tokens.output_tokens += output_tokens;
    stats.tokens.total_tokens += input_tokens + output_tokens;
    stats.tokens.total_cost_usd = ((stats.tokens.total_cost_usd + cost) * 100000.0).round() / 100000.0;
    stats.total_cost_usd = ((stats.tts.total_cost_usd + stats.tokens.total_cost_usd) * 100000.0).round() / 100000.0;
    save_stats_in(root, &stats)?;
    Ok(stats)
}

#[tauri::command]
pub fn load_conversation(state: State<ProjectState>) -> Result<Option<String>> {
    let root = state.root()?;
    let path = conversation_file(&root);
    if path.is_file() {
        let content = fs::read_to_string(path)?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_conversation(state: State<ProjectState>, content: String) -> Result<()> {
    let root = state.root()?;
    let lios_dir = root.join(".liosvideo");
    let _ = fs::create_dir_all(&lios_dir);
    fs::write(conversation_file(&root), content)?;
    Ok(())
}

#[tauri::command]
pub fn get_project_stats(state: State<ProjectState>) -> Result<ProjectStats> {
    let root = state.root()?;
    Ok(load_stats_in(&root))
}

#[tauri::command]
pub fn record_token_usage(
    app: AppHandle,
    state: State<ProjectState>,
    input_tokens: usize,
    output_tokens: usize,
    model: Option<String>,
) -> Result<ProjectStats> {
    let root = state.root()?;
    let stats = record_token_usage_in(&root, input_tokens, output_tokens, model.as_deref())?;
    let _ = app.emit("project://stats_updated", &stats);
    Ok(stats)
}

#[tauri::command]
pub fn record_tts_usage(
    app: AppHandle,
    state: State<ProjectState>,
    line_id: String,
    provider: String,
    voice: String,
    text: String,
) -> Result<ProjectStats> {
    let root = state.root()?;
    let stats = record_tts_usage_in(&root, &line_id, &provider, &voice, &text)?;
    let _ = app.emit("project://stats_updated", &stats);
    Ok(stats)
}

/// The non-Tauri part of opening: canonical root, history status, and a "Manual edit" commit for pending changes.
pub fn prepare_open(root: &Path) -> Result<(PathBuf, HistoryStatus, Option<CommitInfo>)> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(ProjectError::Other(format!("{} is not a folder", root.display())));
    }
    let status = git::history_status(&root);
    let auto = status == HistoryStatus::Enabled && git::can_auto_commit(&root);
    let commit = if auto { git::commit_all(&root, git::MANUAL_EDIT)? } else { None };
    Ok((root, status, commit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_project_path() {
        let p1 = normalize_project_path("Users/hanif/Labs/personal/Perkenalan%20Product%20LiosVideo");
        assert_eq!(p1, PathBuf::from("/Users/hanif/Labs/personal/Perkenalan Product LiosVideo"));

        let p2 = normalize_project_path("file:///Users/hanif/Labs/test%20folder");
        assert_eq!(p2, PathBuf::from("/Users/hanif/Labs/test folder"));
    }
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
    fn rejects_dangling_symlinks_leading_outside() {
        let dir = project();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path().join("new"), dir.path().join("out")).unwrap();
        assert!(resolve_in_project(dir.path(), "out").is_err());
        assert!(resolve_in_project(dir.path(), "out/deeper.txt").is_err());
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

    #[test]
    fn open_never_commits_into_an_unmanaged_repo() {
        let dir = project();
        git2::Repository::init(dir.path()).unwrap();
        let (_, status, commit) = prepare_open(dir.path()).unwrap();
        assert_eq!(status, HistoryStatus::Unmanaged);
        assert!(commit.is_none());
        assert!(git2::Repository::open(dir.path()).unwrap().head().is_err(), "still no commits");
    }

    #[test]
    fn open_works_but_skips_commit_during_a_merge() {
        let dir = project();
        crate::git::enable_history(dir.path()).unwrap();
        let head = crate::git::history(dir.path(), 1).unwrap()[0].id.clone();
        fs::write(dir.path().join(".git/MERGE_HEAD"), format!("{head}\n")).unwrap();
        fs::write(dir.path().join("scenes/a.ts"), "export const edited = 1;").unwrap();
        let (_, status, commit) = prepare_open(dir.path()).unwrap();
        assert_eq!(status, HistoryStatus::Enabled);
        assert!(commit.is_none());
    }

    #[test]
    fn git_jobs_run_off_the_caller_and_one_at_a_time() {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        use std::sync::Arc;
        let busy = Arc::new(AtomicBool::new(false));
        let overlaps = Arc::new(AtomicUsize::new(0));
        let caller = std::thread::current().id();
        let job = || {
            let (busy, overlaps) = (busy.clone(), overlaps.clone());
            tauri::async_runtime::spawn(git_job(move || {
                assert_ne!(std::thread::current().id(), caller);
                if busy.swap(true, Ordering::SeqCst) {
                    overlaps.fetch_add(1, Ordering::SeqCst);
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
                busy.store(false, Ordering::SeqCst);
                Ok(())
            }))
        };
        let (a, b) = (job(), job());
        tauri::async_runtime::block_on(async {
            a.await.unwrap().unwrap();
            b.await.unwrap().unwrap();
        });
        assert_eq!(overlaps.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn test_stats_and_conversation_persistence() {
        let dir = project();
        let root = dir.path();

        // 1. Conversation saving and loading
        let conv_file = conversation_file(root);
        assert_eq!(conv_file, root.join(".liosvideo/conversation.json"));
        fs::create_dir_all(root.join(".liosvideo")).unwrap();
        fs::write(&conv_file, r#"{"items":[{"kind":"user","text":"halo"}]}"#).unwrap();
        let loaded = fs::read_to_string(&conv_file).unwrap();
        assert!(loaded.contains("halo"));

        // 2. TTS usage recording
        let stats = record_tts_usage_in(root, "line-1", "elevenlabs", "rachel", "Halo dunia video").unwrap();
        assert_eq!(stats.tts.total_characters, 16);
        assert!(stats.tts.total_cost_usd > 0.0);
        assert_eq!(stats.tts.items.len(), 1);

        // 3. Token usage recording
        let stats2 = record_token_usage_in(root, 1000, 200, Some("claude-3-7-sonnet")).unwrap();
        assert_eq!(stats2.tokens.input_tokens, 1000);
        assert_eq!(stats2.tokens.output_tokens, 200);
        assert_eq!(stats2.tokens.total_tokens, 1200);
        assert!(stats2.tokens.total_cost_usd > 0.0);
        assert!(stats2.total_cost_usd >= stats2.tokens.total_cost_usd);

        // 4. Persistence verification
        let loaded_stats = load_stats_in(root);
        assert_eq!(loaded_stats.tts.total_characters, 16);
        assert_eq!(loaded_stats.tokens.total_tokens, 1200);
    }
}
