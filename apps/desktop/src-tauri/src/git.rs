use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::project::ProjectError;

type Result<T> = std::result::Result<T, ProjectError>;

#[derive(Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HistoryStatus {
    Enabled,
    Off,
    Nested { repo: String },
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub message: String,
    /// unix seconds
    pub time: i64,
}

pub const MANUAL_EDIT: &str = "Manual edit";

pub const GITIGNORE_LINES: [&str; 4] = [".liosvideo/cache/", "out/", "node_modules/", ".DS_Store"];

fn git_err(e: git2::Error) -> ProjectError {
    ProjectError::Other(e.message().to_string())
}

impl From<git2::Error> for ProjectError {
    fn from(e: git2::Error) -> Self {
        git_err(e)
    }
}

/// History is only managed for folders that are themselves a repo root; never a parent repo's subfolder.
pub fn history_status(root: &Path) -> HistoryStatus {
    if root.join(".git").exists() && git2::Repository::open(root).is_ok() {
        return HistoryStatus::Enabled;
    }
    let Ok(repo) = git2::Repository::discover(root) else { return HistoryStatus::Off };
    match repo.workdir().and_then(|w| w.canonicalize().ok()) {
        Some(w) if root.canonicalize().map(|r| r != w).unwrap_or(true) => {
            HistoryStatus::Nested { repo: w.to_string_lossy().into_owned() }
        }
        _ => HistoryStatus::Off,
    }
}

/// Starts tracking a folder: project.json, required .gitignore lines, `git init`, first commit.
pub fn enable_history(root: &Path) -> Result<CommitInfo> {
    match history_status(root) {
        HistoryStatus::Off => {}
        HistoryStatus::Enabled => return Err(ProjectError::Other("History is already enabled".into())),
        HistoryStatus::Nested { repo } => {
            return Err(ProjectError::Other(format!("This folder is inside another git repository ({repo})")));
        }
    }
    let settings = root.join(".liosvideo/project.json");
    if !settings.exists() {
        fs::create_dir_all(root.join(".liosvideo"))?;
        fs::write(&settings, "{ \"version\": 1 }\n")?;
    }
    let ignore_path = root.join(".gitignore");
    let mut ignore = fs::read_to_string(&ignore_path).unwrap_or_default();
    let missing: Vec<&str> = GITIGNORE_LINES.iter().copied().filter(|l| !ignore.lines().any(|x| x.trim() == *l)).collect();
    if !missing.is_empty() {
        if !ignore.is_empty() && !ignore.ends_with('\n') {
            ignore.push('\n');
        }
        for l in missing {
            ignore.push_str(l);
            ignore.push('\n');
        }
        fs::write(&ignore_path, ignore)?;
    }
    git2::Repository::init(root)?;
    commit_all(root, "Start history")?.ok_or_else(|| ProjectError::Other("nothing to commit".into()))
}

fn signature(repo: &git2::Repository) -> Result<git2::Signature<'static>> {
    Ok(repo.signature().or_else(|_| git2::Signature::now("liosvideo", "liosvideo@localhost"))?)
}

pub(crate) fn info(c: &git2::Commit) -> CommitInfo {
    let id = c.id().to_string();
    CommitInfo {
        short_id: id[..7].to_string(),
        id,
        summary: c.summary().into_iter().flatten().next().unwrap_or("").to_string(),
        message: c.message().unwrap_or("").to_string(),
        time: c.time().seconds(),
    }
}

pub(crate) fn commit_tree(repo: &git2::Repository, tree: &git2::Tree, message: &str) -> Result<CommitInfo> {
    let sig = signature(repo)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let id = repo.commit(Some("HEAD"), &sig, &sig, message, tree, &parents)?;
    Ok(info(&repo.find_commit(id)?))
}

/// Stages every change (respecting .gitignore) and commits it; `None` when nothing changed.
pub fn commit_all(root: &Path, message: &str) -> Result<Option<CommitInfo>> {
    let repo = git2::Repository::open(root)?;
    let mut index = repo.index()?;
    index.add_all(["*"], git2::IndexAddOption::DEFAULT, None)?;
    index.update_all(["*"], None)?;
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    if head_tree.is_some_and(|t| t.id() == tree.id()) {
        return Ok(None);
    }
    commit_tree(&repo, &tree, message).map(Some)
}

/// Newest first, following first parents from HEAD.
pub fn history(root: &Path, limit: usize) -> Result<Vec<CommitInfo>> {
    let repo = git2::Repository::open(root)?;
    let mut walk = repo.revwalk()?;
    if walk.push_head().is_err() {
        return Ok(vec![]);
    }
    walk.simplify_first_parent()?;
    walk.take(limit).map(|id| Ok(info(&repo.find_commit(id?)?))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn folder() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    fn head_files(root: &Path) -> Vec<String> {
        let repo = git2::Repository::open(root).unwrap();
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let mut files = vec![];
        tree.walk(git2::TreeWalkMode::PreOrder, |dir, e| {
            if e.kind() == Some(git2::ObjectType::Blob) {
                files.push(format!("{dir}{}", e.name().unwrap()));
            }
            git2::TreeWalkResult::Ok
        })
        .unwrap();
        files.sort();
        files
    }

    #[test]
    fn status_is_off_for_plain_folder() {
        let dir = folder();
        assert_eq!(history_status(dir.path()), HistoryStatus::Off);
    }

    #[test]
    fn status_is_nested_inside_another_repo() {
        let dir = folder();
        git2::Repository::init(dir.path()).unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let repo = dir.path().canonicalize().unwrap().to_string_lossy().into_owned();
        assert_eq!(history_status(&dir.path().join("sub")), HistoryStatus::Nested { repo });
    }

    #[test]
    fn status_is_off_writes_nothing() {
        let dir = folder();
        fs::write(dir.path().join("a.ts"), "x").unwrap();
        history_status(dir.path());
        assert_eq!(entries(dir.path()), vec!["a.ts"]);
    }

    #[test]
    fn enable_history_creates_repo_gitignore_and_first_commit() {
        let dir = folder();
        fs::write(dir.path().join(".gitignore"), "foo\n").unwrap();
        enable_history(dir.path()).unwrap();
        assert_eq!(history_status(dir.path()), HistoryStatus::Enabled);
        let log = history(dir.path(), 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].summary, "Start history");
        let ignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        for line in ["foo", "out/", ".liosvideo/cache/", "node_modules/", ".DS_Store"] {
            assert!(ignore.lines().any(|l| l == line), "missing {line}");
        }
        assert!(dir.path().join(".liosvideo/project.json").exists());
    }

    #[test]
    fn enable_history_refuses_nested() {
        let dir = folder();
        git2::Repository::init(dir.path()).unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        assert!(enable_history(&dir.path().join("sub")).is_err());
        assert!(!dir.path().join("sub/.git").exists());
    }

    #[test]
    fn commit_all_returns_none_when_clean() {
        let dir = folder();
        enable_history(dir.path()).unwrap();
        assert!(commit_all(dir.path(), "nothing").unwrap().is_none());
        assert_eq!(history(dir.path(), 10).unwrap().len(), 1);
    }

    #[test]
    fn commit_all_commits_adds_edits_and_deletes() {
        let dir = folder();
        enable_history(dir.path()).unwrap();
        let p = dir.path();
        fs::write(p.join("a.ts"), "1").unwrap();
        commit_all(p, "add a").unwrap().unwrap();
        fs::write(p.join("a.ts"), "2").unwrap();
        fs::write(p.join("b.ts"), "1").unwrap();
        commit_all(p, "edit a, add b").unwrap().unwrap();
        fs::remove_file(p.join("a.ts")).unwrap();
        commit_all(p, "delete a").unwrap().unwrap();
        assert_eq!(head_files(p), vec![".gitignore", ".liosvideo/project.json", "b.ts"]);
        let summaries: Vec<String> = history(p, 10).unwrap().into_iter().map(|c| c.summary).collect();
        assert_eq!(summaries, vec!["delete a", "edit a, add b", "add a", "Start history"]);
    }

    #[test]
    fn commit_all_skips_ignored_files() {
        let dir = folder();
        enable_history(dir.path()).unwrap();
        let p = dir.path();
        fs::create_dir_all(p.join("out")).unwrap();
        fs::create_dir_all(p.join(".liosvideo/cache")).unwrap();
        fs::write(p.join("out/x.mp4"), "v").unwrap();
        fs::write(p.join(".liosvideo/cache/c"), "c").unwrap();
        fs::write(p.join("a.ts"), "1").unwrap();
        commit_all(p, "add").unwrap().unwrap();
        assert_eq!(head_files(p), vec![".gitignore", ".liosvideo/project.json", "a.ts"]);
    }
}
