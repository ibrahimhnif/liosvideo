use std::fs;
use std::path::{Path, PathBuf};

use crate::project::ProjectError;

type Result<T> = std::result::Result<T, ProjectError>;

const TEMPLATES: [(&str, &str); 7] = [
    ("long.ts", include_str!("../templates/long.ts")),
    ("short.ts", include_str!("../templates/short.ts")),
    ("scenes/intro.ts", include_str!("../templates/scenes/intro.ts")),
    ("script.md", include_str!("../templates/script.md")),
    ("AGENTS.md", include_str!("../templates/AGENTS.md")),
    (".gitignore", include_str!("../templates/gitignore")),
    (".liosvideo/project.json", include_str!("../templates/project.json")),
];

const ASSET_DIRS: [&str; 5] = ["assets/images", "assets/video", "assets/fonts", "assets/audio/vo", "assets/audio/music"];

/// A project name becomes a single folder name inside the chosen parent.
pub fn validate_project_name(name: &str) -> Result<()> {
    let bad = |why: &str| Err(ProjectError::Other(format!("Invalid project name: {why}")));
    if name.trim().is_empty() {
        return bad("it is empty");
    }
    if name.contains('/') || name.contains('\\') {
        return bad("it must not contain / or \\");
    }
    if name.starts_with('.') {
        return bad("it must not start with a dot");
    }
    Ok(())
}

/// Creates `parent/name` from the templates and makes the initial commit. Never touches an existing folder.
pub fn create_project_in(parent: &Path, name: &str) -> Result<PathBuf> {
    create_project_with(parent, name, crate::git::init_history)
}

/// `create_project_in` with the history step injectable; on any failure the new folder is removed.
pub fn create_project_with(parent: &Path, name: &str, init: impl Fn(&Path) -> Result<crate::git::CommitInfo>) -> Result<PathBuf> {
    validate_project_name(name)?;
    let root = parent.join(name);
    if root.exists() {
        return Err(ProjectError::Other(format!("{} already exists", root.display())));
    }
    fs::create_dir(&root)?;
    // only this call created `root`, so removing it on failure can't touch the user's files
    let result = populate(&root, init);
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

fn populate(root: &Path, init: impl Fn(&Path) -> Result<crate::git::CommitInfo>) -> Result<PathBuf> {
    for (rel, content) in TEMPLATES {
        let path = root.join(rel);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(path, content)?;
    }
    for dir in ASSET_DIRS {
        fs::create_dir_all(root.join(dir))?;
        fs::write(root.join(dir).join(".gitkeep"), "")?;
    }
    for link in ["CLAUDE.md", "GEMINI.md"] {
        std::os::unix::fs::symlink("AGENTS.md", root.join(link))?;
    }
    let root = root.canonicalize()?;
    init(&root)?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{history, history_status, HistoryStatus};
    use std::fs;

    #[test]
    fn rejects_bad_names() {
        for name in ["", "   ", "a/b", "a\\b", ".", "..", ".hidden"] {
            assert!(validate_project_name(name).is_err(), "accepted {name:?}");
        }
        assert!(validate_project_name("php2shell").is_ok());
        assert!(validate_project_name("My Video 2").is_ok());
    }

    #[test]
    fn refuses_existing_folder_and_leaves_it_untouched() {
        let parent = tempfile::tempdir().unwrap();
        let existing = parent.path().join("video");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("keep.txt"), "mine").unwrap();
        assert!(create_project_in(parent.path(), "video").is_err());
        let names: Vec<_> = fs::read_dir(&existing).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec!["keep.txt"]);
        assert_eq!(fs::read_to_string(existing.join("keep.txt")).unwrap(), "mine");
    }

    #[test]
    fn creates_layout_and_initial_commit() {
        let parent = tempfile::tempdir().unwrap();
        let root = create_project_in(parent.path(), "php2shell").unwrap();
        assert_eq!(root, parent.path().join("php2shell").canonicalize().unwrap());
        for rel in [
            "long.ts", "short.ts", "scenes/intro.ts", "script.md", "AGENTS.md", ".gitignore",
            ".liosvideo/project.json", "assets/images", "assets/video", "assets/fonts", "assets/audio/vo", "assets/audio/music",
        ] {
            assert!(root.join(rel).exists(), "missing {rel}");
        }
        let agents = fs::read_to_string(root.join("AGENTS.md")).unwrap();
        for link in ["CLAUDE.md", "GEMINI.md"] {
            assert!(fs::symlink_metadata(root.join(link)).unwrap().file_type().is_symlink());
            assert_eq!(fs::read_link(root.join(link)).unwrap(), Path::new("AGENTS.md"));
            assert_eq!(fs::read_to_string(root.join(link)).unwrap(), agents);
        }
        assert_eq!(history_status(&root), HistoryStatus::Enabled);
        assert_eq!(history(&root, 10).unwrap().len(), 1);
        assert!(crate::git::commit_all(&root, "x").unwrap().is_none(), "everything is committed");
    }

    #[test]
    fn creates_history_even_inside_another_repo() {
        let outer = tempfile::tempdir().unwrap();
        git2::Repository::init(outer.path()).unwrap();
        let root = create_project_in(outer.path(), "video").unwrap();
        assert_eq!(history_status(&root), HistoryStatus::Enabled);
    }

    #[test]
    fn failed_create_leaves_nothing_behind() {
        let parent = tempfile::tempdir().unwrap();
        let failing = |_: &Path| -> Result<crate::git::CommitInfo> { Err(ProjectError::Other("boom".into())) };
        assert!(create_project_with(parent.path(), "video", failing).is_err());
        assert!(!parent.path().join("video").exists());
        assert!(create_project_in(parent.path(), "video").is_ok(), "a retry works");
    }
}
