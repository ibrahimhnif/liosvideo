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
    /// a repo the app didn't create; nothing is committed until the user opts in
    Unmanaged,
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

/// Marks a repo whose history the app manages (written by `init_history`).
const MARKER: &str = ".liosvideo/project.json";

pub fn history_status(root: &Path) -> HistoryStatus {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    history_status_in(root, home.as_deref())
}

/// Enabled: a repo root with the app's marker. Unmanaged: someone else's repo root.
/// Nested: inside another repo that tracks this folder (a home-folder dotfiles repo, or one that ignores it, doesn't count).
pub fn history_status_in(root: &Path, home: Option<&Path>) -> HistoryStatus {
    if root.join(".git").exists() && git2::Repository::open(root).is_ok() {
        return if root.join(MARKER).is_file() { HistoryStatus::Enabled } else { HistoryStatus::Unmanaged };
    }
    let Ok(root) = root.canonicalize() else { return HistoryStatus::Off };
    let Ok(repo) = git2::Repository::discover(&root) else { return HistoryStatus::Off };
    let Some(workdir) = repo.workdir().and_then(|w| w.canonicalize().ok()) else { return HistoryStatus::Off };
    let is_home = home.and_then(|h| h.canonicalize().ok()).is_some_and(|h| h == workdir);
    let ignored = root.strip_prefix(&workdir).is_ok_and(|rel| repo.is_path_ignored(rel).unwrap_or(false));
    if workdir == root || is_home || ignored {
        return HistoryStatus::Off;
    }
    HistoryStatus::Nested { repo: workdir.to_string_lossy().into_owned() }
}

/// Whether the app may commit on its own: a normal branch with no merge, rebase or similar in progress.
pub fn can_auto_commit(root: &Path) -> bool {
    git2::Repository::open(root)
        .is_ok_and(|repo| repo.state() == git2::RepositoryState::Clean && !repo.head_detached().unwrap_or(true))
}

/// Starts tracking a folder the user chose: refuses nested folders and already-managed repos.
pub fn enable_history(root: &Path) -> Result<CommitInfo> {
    match history_status(root) {
        HistoryStatus::Off | HistoryStatus::Unmanaged => init_history(root),
        HistoryStatus::Enabled => Err(ProjectError::Other("History is already enabled".into())),
        HistoryStatus::Nested { repo } => {
            Err(ProjectError::Other(format!("This folder is inside another git repository ({repo})")))
        }
    }
}

/// project.json (the marker), required .gitignore lines, `git init` unless a repo exists, first commit.
pub fn init_history(root: &Path) -> Result<CommitInfo> {
    let settings = root.join(MARKER);
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
    if !root.join(".git").exists() {
        git2::Repository::init(root)?;
    }
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

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    /// "added" | "modified" | "deleted" | "renamed"
    pub status: String,
    pub binary: bool,
    pub patch: String,
    pub truncated: bool,
}

pub const MAX_PATCH_BYTES: usize = 200 * 1024;

fn find_commit<'r>(repo: &'r git2::Repository, id: &str) -> Result<git2::Commit<'r>> {
    Ok(repo.find_commit(git2::Oid::from_str(id)?)?)
}

/// Files a commit changed against its first parent (or the empty tree for the first commit).
pub fn commit_diff(root: &Path, id: &str) -> Result<Vec<FileDiff>> {
    let repo = git2::Repository::open(root)?;
    let commit = find_commit(&repo, id)?;
    let parent_tree = commit.parents().next().map(|p| p.tree()).transpose()?;
    let mut opts = git2::DiffOptions::new();
    opts.context_lines(3);
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit.tree()?), Some(&mut opts))?;
    diff.find_similar(None)?;
    let mut files = vec![];
    for i in 0..diff.deltas().len() {
        let delta = diff.get_delta(i).expect("delta index in range");
        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Renamed => "renamed",
            _ => "modified",
        };
        let file = if delta.status() == git2::Delta::Deleted { delta.old_file() } else { delta.new_file() };
        let path = file.path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let mut patch = git2::Patch::from_diff(&diff, i)?;
        let binary = patch.as_ref().map_or(true, |p| p.delta().flags().is_binary());
        let mut text = match (&mut patch, binary) {
            (Some(p), false) => String::from_utf8_lossy(p.to_buf()?.as_ref()).into_owned(),
            _ => String::new(),
        };
        let truncated = text.len() > MAX_PATCH_BYTES;
        if truncated {
            let mut cut = MAX_PATCH_BYTES;
            while !text.is_char_boundary(cut) {
                cut -= 1;
            }
            text.truncate(cut);
        }
        files.push(FileDiff { path, status: status.to_string(), binary, patch: text, truncated });
    }
    Ok(files)
}

/// Brings back a commit's tree as a new commit on top of HEAD; pending edits are committed first.
pub fn restore(root: &Path, id: &str) -> Result<CommitInfo> {
    commit_all(root, MANUAL_EDIT)?;
    let repo = git2::Repository::open(root)?;
    let target = find_commit(&repo, id)?;
    let tree = target.tree()?;
    if repo.head()?.peel_to_tree()?.id() == tree.id() {
        return Err(ProjectError::Other("Already at this version".into()));
    }
    repo.checkout_tree(tree.as_object(), Some(git2::build::CheckoutBuilder::new().force()))?;
    let mut index = repo.index()?;
    index.read_tree(&tree)?;
    index.write()?;
    let c = info(&target);
    commit_tree(&repo, &tree, &format!("Restore to {}: {}", c.short_id, c.summary))
}

/// Reverts specific files to the state prior to commit `id` (its parent commit).
pub fn revert_files(root: &Path, id: &str, paths: &[String]) -> Result<CommitInfo> {
    commit_all(root, MANUAL_EDIT)?;
    let repo = git2::Repository::open(root)?;
    let target = find_commit(&repo, id)?;
    let parent = target.parents().next().ok_or_else(|| ProjectError::Other("Commit has no parent".into()))?;
    let parent_tree = parent.tree()?;
    let mut builder = git2::build::CheckoutBuilder::new();
    builder.force();
    for p in paths {
        builder.path(p);
    }
    repo.checkout_tree(parent_tree.as_object(), Some(&mut builder))?;
    let commit = commit_all(root, &format!("Revert out-of-scope changes: {}", paths.join(", ")))?
        .ok_or_else(|| ProjectError::Other("Nothing was reverted".into()))?;
    Ok(commit)
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

    fn repo_with(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = folder();
        enable_history(dir.path()).unwrap();
        for (f, c) in files {
            fs::write(dir.path().join(f), c).unwrap();
        }
        dir
    }

    #[test]
    fn diff_lists_added_modified_deleted_files_with_patches() {
        let dir = repo_with(&[("a.ts", "old\n"), ("gone.ts", "x\n")]);
        let p = dir.path();
        commit_all(p, "base").unwrap();
        fs::write(p.join("a.ts"), "new\n").unwrap();
        fs::remove_file(p.join("gone.ts")).unwrap();
        fs::write(p.join("b.ts"), "b\n").unwrap();
        let c = commit_all(p, "change").unwrap().unwrap();
        let d = commit_diff(p, &c.id).unwrap();
        let status = |path: &str| d.iter().find(|f| f.path == path).map(|f| f.status.as_str());
        assert_eq!(status("a.ts"), Some("modified"));
        assert_eq!(status("b.ts"), Some("added"));
        assert_eq!(status("gone.ts"), Some("deleted"));
        let a = d.iter().find(|f| f.path == "a.ts").unwrap();
        assert!(a.patch.contains("-old") && a.patch.contains("+new"), "{}", a.patch);
        assert!(!a.binary && !a.truncated);
    }

    #[test]
    fn diff_of_root_commit_lists_all_files_as_added() {
        let dir = folder();
        fs::write(dir.path().join("a.ts"), "1\n").unwrap();
        let c = enable_history(dir.path()).unwrap();
        let d = commit_diff(dir.path(), &c.id).unwrap();
        assert_eq!(d.len(), 3);
        assert!(d.iter().all(|f| f.status == "added"));
    }

    #[test]
    fn diff_marks_binary_files_without_patch() {
        let dir = repo_with(&[]);
        let p = dir.path();
        fs::create_dir_all(p.join("assets/images")).unwrap();
        fs::write(p.join("assets/images/x.png"), [0x89u8, b'P', b'N', b'G', 0, 0, 0, 13, 0, 1, 2]).unwrap();
        let c = commit_all(p, "image").unwrap().unwrap();
        let d = commit_diff(p, &c.id).unwrap();
        assert_eq!(d.len(), 1);
        assert!(d[0].binary);
        assert_eq!(d[0].patch, "");
    }

    #[test]
    fn diff_truncates_huge_patches() {
        let dir = repo_with(&[]);
        let p = dir.path();
        fs::write(p.join("big.txt"), "line of text\n".repeat(300 * 1024 / 13)).unwrap();
        let c = commit_all(p, "big").unwrap().unwrap();
        let d = commit_diff(p, &c.id).unwrap();
        assert!(d[0].truncated);
        assert!(d[0].patch.len() <= MAX_PATCH_BYTES);
    }

    #[test]
    fn restore_brings_back_old_tree_as_new_commit() {
        let dir = repo_with(&[("a.ts", "1")]);
        let p = dir.path();
        let a = commit_all(p, "A").unwrap().unwrap();
        fs::write(p.join("a.ts"), "2").unwrap();
        fs::write(p.join("b.ts"), "b").unwrap();
        commit_all(p, "B").unwrap().unwrap();
        restore(p, &a.id).unwrap();
        assert_eq!(fs::read_to_string(p.join("a.ts")).unwrap(), "1");
        assert!(!p.join("b.ts").exists());
        let summaries: Vec<String> = history(p, 10).unwrap().into_iter().map(|c| c.summary).collect();
        assert_eq!(summaries.len(), 4);
        assert!(summaries[0].starts_with("Restore to "), "{}", summaries[0]);
        assert_eq!(&summaries[1..3], &["B", "A"]);
        assert!(commit_all(p, "x").unwrap().is_none(), "index and workdir match the restored tree");
    }

    #[test]
    fn restore_commits_pending_edits_first() {
        let dir = repo_with(&[("a.ts", "1")]);
        let p = dir.path();
        let a = commit_all(p, "A").unwrap().unwrap();
        fs::write(p.join("a.ts"), "unsaved work").unwrap();
        restore(p, &a.id).unwrap();
        let log = history(p, 10).unwrap();
        assert_eq!(log[1].summary, MANUAL_EDIT);
        let repo = git2::Repository::open(p).unwrap();
        let tree = repo.find_commit(git2::Oid::from_str(&log[1].id).unwrap()).unwrap().tree().unwrap();
        let blob = tree.get_name("a.ts").unwrap().to_object(&repo).unwrap().peel_to_blob().unwrap();
        assert_eq!(blob.content(), b"unsaved work");
    }

    #[test]
    fn restore_keeps_ignored_files() {
        let dir = repo_with(&[("a.ts", "1")]);
        let p = dir.path();
        let a = commit_all(p, "A").unwrap().unwrap();
        fs::write(p.join("a.ts"), "2").unwrap();
        commit_all(p, "B").unwrap().unwrap();
        fs::create_dir_all(p.join("out")).unwrap();
        fs::write(p.join("out/video.mp4"), "v").unwrap();
        restore(p, &a.id).unwrap();
        assert!(p.join("out/video.mp4").exists());
    }

    #[test]
    fn restore_to_current_tree_is_an_error() {
        let dir = repo_with(&[("a.ts", "1")]);
        let p = dir.path();
        let a = commit_all(p, "A").unwrap().unwrap();
        assert!(restore(p, &a.id).is_err());
        assert_eq!(history(p, 10).unwrap().len(), 2);
    }

    #[test]
    fn status_is_unmanaged_for_repo_without_marker() {
        let dir = folder();
        git2::Repository::init(dir.path()).unwrap();
        assert_eq!(history_status(dir.path()), HistoryStatus::Unmanaged);
    }

    #[test]
    fn enable_history_adopts_unmanaged_repo_keeping_its_commits() {
        let dir = folder();
        let p = dir.path();
        git2::Repository::init(p).unwrap();
        fs::write(p.join("a.ts"), "1").unwrap();
        fs::create_dir(p.join(".liosvideo")).unwrap();
        fs::write(p.join(".liosvideo/project.json"), "{}").unwrap();
        commit_all(p, "user commit").unwrap().unwrap();
        fs::remove_file(p.join(".liosvideo/project.json")).unwrap();
        commit_all(p, "drop marker").unwrap().unwrap();
        assert_eq!(history_status(p), HistoryStatus::Unmanaged);
        enable_history(p).unwrap();
        assert_eq!(history_status(p), HistoryStatus::Enabled);
        let summaries: Vec<String> = history(p, 10).unwrap().into_iter().map(|c| c.summary).collect();
        assert_eq!(summaries, vec!["Start history", "drop marker", "user commit"]);
    }

    #[test]
    fn status_is_off_when_outer_repo_ignores_folder() {
        let dir = folder();
        git2::Repository::init(dir.path()).unwrap();
        fs::write(dir.path().join(".gitignore"), "*\n").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        assert_eq!(history_status(&dir.path().join("sub")), HistoryStatus::Off);
    }

    #[test]
    fn status_is_off_when_outer_repo_is_home() {
        let dir = folder();
        git2::Repository::init(dir.path()).unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        assert_eq!(history_status_in(&dir.path().join("sub"), Some(dir.path())), HistoryStatus::Off);
    }

    #[test]
    fn auto_commit_is_skipped_while_a_merge_is_in_progress() {
        let dir = repo_with(&[("a.ts", "1")]);
        let p = dir.path();
        let head = history(p, 1).unwrap()[0].id.clone();
        fs::write(p.join(".git/MERGE_HEAD"), format!("{head}\n")).unwrap();
        assert!(!can_auto_commit(p));
    }

    #[test]
    fn auto_commit_is_skipped_on_detached_head() {
        let dir = repo_with(&[("a.ts", "1")]);
        let p = dir.path();
        commit_all(p, "A").unwrap();
        let repo = git2::Repository::open(p).unwrap();
        let id = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(id).unwrap();
        assert!(!can_auto_commit(p));
    }

    #[test]
    fn auto_commit_is_allowed_on_a_clean_branch() {
        let dir = repo_with(&[]);
        assert!(can_auto_commit(dir.path()));
    }
}
