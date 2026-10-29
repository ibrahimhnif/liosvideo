use std::fs;
use std::path::{Path, PathBuf};

use crate::project::ProjectError;

type Result<T> = std::result::Result<T, ProjectError>;

const SHARED_TEMPLATES: [(&str, &str); 4] = [
    ("AGENTS.md", include_str!("../templates/AGENTS.md")),
    (".gitignore", include_str!("../templates/gitignore")),
    (".liosvideo/project.json", include_str!("../templates/project.json")),
    (".agents/skills/liosvideo/SKILL.md", include_str!("../templates/skills/liosvideo/SKILL.md")),
];

const BLANK_TEMPLATES: [(&str, &str); 4] = [
    ("long.ts", include_str!("../templates/long.ts")),
    ("short.ts", include_str!("../templates/short.ts")),
    ("scenes/intro.ts", include_str!("../templates/scenes/intro.ts")),
    ("script.md", include_str!("../templates/script.md")),
];

const MINIMAL_DEV_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("../templates/minimal-dev/theme.ts")),
    ("scenes/intro.ts", include_str!("../templates/minimal-dev/scenes/intro.ts")),
    ("scenes/main.ts", include_str!("../templates/minimal-dev/scenes/main.ts")),
    ("scenes/outro.ts", include_str!("../templates/minimal-dev/scenes/outro.ts")),
    ("long.ts", include_str!("../templates/minimal-dev/long.ts")),
    ("short.ts", include_str!("../templates/minimal-dev/short.ts")),
    ("script.md", include_str!("../templates/minimal-dev/script.md")),
];

const PRODUCT_3D_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("../templates/product-3d/theme.ts")),
    ("scenes/intro.ts", include_str!("../templates/product-3d/scenes/intro.ts")),
    ("scenes/main.ts", include_str!("../templates/product-3d/scenes/main.ts")),
    ("scenes/outro.ts", include_str!("../templates/product-3d/scenes/outro.ts")),
    ("long.ts", include_str!("../templates/product-3d/long.ts")),
    ("short.ts", include_str!("../templates/product-3d/short.ts")),
    ("script.md", include_str!("../templates/product-3d/script.md")),
];

const KINETIC_SHORT_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("../templates/kinetic-short/theme.ts")),
    ("scenes/intro.ts", include_str!("../templates/kinetic-short/scenes/intro.ts")),
    ("scenes/main.ts", include_str!("../templates/kinetic-short/scenes/main.ts")),
    ("scenes/outro.ts", include_str!("../templates/kinetic-short/scenes/outro.ts")),
    ("long.ts", include_str!("../templates/kinetic-short/long.ts")),
    ("short.ts", include_str!("../templates/kinetic-short/short.ts")),
    ("script.md", include_str!("../templates/kinetic-short/script.md")),
];

const SAAS_LAUNCH_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("../templates/saas-launch/theme.ts")),
    ("scenes/intro.ts", include_str!("../templates/saas-launch/scenes/intro.ts")),
    ("scenes/main.ts", include_str!("../templates/saas-launch/scenes/main.ts")),
    ("scenes/outro.ts", include_str!("../templates/saas-launch/scenes/outro.ts")),
    ("long.ts", include_str!("../templates/saas-launch/long.ts")),
    ("short.ts", include_str!("../templates/saas-launch/short.ts")),
    ("script.md", include_str!("../templates/saas-launch/script.md")),
];

const ASSET_DIRS: [&str; 5] = ["assets/images", "assets/video", "assets/fonts", "assets/audio/vo", "assets/audio/music"];

pub fn validate_template_id(template: Option<&str>) -> Result<&str> {
    match template.map(str::trim).filter(|s| !s.is_empty()) {
        None | Some("blank") => Ok("blank"),
        Some("minimal-dev") => Ok("minimal-dev"),
        Some("product-3d") => Ok("product-3d"),
        Some("kinetic-short") => Ok("kinetic-short"),
        Some("saas-launch") => Ok("saas-launch"),
        Some(unknown) => Err(ProjectError::Other(format!("Unknown template: {unknown}"))),
    }
}

fn template_files(id: &str) -> Vec<(&'static str, &'static str)> {
    let mut files: Vec<(&'static str, &'static str)> = SHARED_TEMPLATES.to_vec();
    match id {
        "minimal-dev" => files.extend_from_slice(&MINIMAL_DEV_TEMPLATES),
        "product-3d" => files.extend_from_slice(&PRODUCT_3D_TEMPLATES),
        "kinetic-short" => files.extend_from_slice(&KINETIC_SHORT_TEMPLATES),
        "saas-launch" => files.extend_from_slice(&SAAS_LAUNCH_TEMPLATES),
        _ => files.extend_from_slice(&BLANK_TEMPLATES),
    }
    files
}

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
pub fn create_project_in(parent: &Path, name: &str, template: Option<&str>) -> Result<PathBuf> {
    create_project_with(parent, name, template, crate::git::init_history)
}

/// `create_project_in` with the history step injectable; on any failure the new folder is removed.
pub fn create_project_with(
    parent: &Path,
    name: &str,
    template: Option<&str>,
    init: impl Fn(&Path) -> Result<crate::git::CommitInfo>,
) -> Result<PathBuf> {
    validate_project_name(name)?;
    let template_id = validate_template_id(template)?;
    let root = parent.join(name);
    if root.exists() {
        return Err(ProjectError::Other(format!("{} already exists", root.display())));
    }
    fs::create_dir(&root)?;
    // only this call created `root`, so removing it on failure can't touch the user's files
    let result = populate(&root, template_id, init);
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

fn populate(root: &Path, template_id: &str, init: impl Fn(&Path) -> Result<crate::git::CommitInfo>) -> Result<PathBuf> {
    for (rel, content) in template_files(template_id) {
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
        #[cfg(unix)]
        std::os::unix::fs::symlink("AGENTS.md", root.join(link))?;
        #[cfg(not(unix))]
        {
            if std::os::windows::fs::symlink_file("AGENTS.md", root.join(link)).is_err() {
                let _ = fs::copy(root.join("AGENTS.md"), root.join(link));
            }
        }
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
    fn validates_templates() {
        assert_eq!(validate_template_id(None).unwrap(), "blank");
        assert_eq!(validate_template_id(Some("")).unwrap(), "blank");
        assert_eq!(validate_template_id(Some("blank")).unwrap(), "blank");
        assert_eq!(validate_template_id(Some("minimal-dev")).unwrap(), "minimal-dev");
        assert_eq!(validate_template_id(Some("product-3d")).unwrap(), "product-3d");
        assert_eq!(validate_template_id(Some("kinetic-short")).unwrap(), "kinetic-short");
        assert_eq!(validate_template_id(Some("saas-launch")).unwrap(), "saas-launch");
        assert!(validate_template_id(Some("unknown-xyz")).is_err());
    }

    #[test]
    fn refuses_existing_folder_and_leaves_it_untouched() {
        let parent = tempfile::tempdir().unwrap();
        let existing = parent.path().join("video");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("keep.txt"), "mine").unwrap();
        assert!(create_project_in(parent.path(), "video", None).is_err());
        let names: Vec<_> = fs::read_dir(&existing).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec!["keep.txt"]);
        assert_eq!(fs::read_to_string(existing.join("keep.txt")).unwrap(), "mine");
    }

    #[test]
    fn creates_layout_and_initial_commit() {
        let parent = tempfile::tempdir().unwrap();
        let root = create_project_in(parent.path(), "php2shell", None).unwrap();
        assert_eq!(root, parent.path().join("php2shell").canonicalize().unwrap());
        for rel in [
            "long.ts", "short.ts", "scenes/intro.ts", "script.md", "AGENTS.md", ".gitignore",
            ".liosvideo/project.json", ".agents/skills/liosvideo/SKILL.md", "assets/images", "assets/video", "assets/fonts", "assets/audio/vo", "assets/audio/music",
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
    fn creates_archetype_templates() {
        let parent = tempfile::tempdir().unwrap();
        for archetype in ["minimal-dev", "product-3d", "kinetic-short", "saas-launch"] {
            let root = create_project_in(parent.path(), archetype, Some(archetype)).unwrap();
            assert!(root.join("theme.ts").exists(), "{archetype} missing theme.ts");
            assert!(root.join("scenes/intro.ts").exists(), "{archetype} missing intro.ts");
            assert!(root.join("scenes/main.ts").exists(), "{archetype} missing main.ts");
            assert!(root.join("scenes/outro.ts").exists(), "{archetype} missing outro.ts");
            assert!(root.join("long.ts").exists(), "{archetype} missing long.ts");
            assert!(root.join("short.ts").exists(), "{archetype} missing short.ts");
            assert!(root.join("script.md").exists(), "{archetype} missing script.md");
            assert!(root.join(".agents/skills/liosvideo/SKILL.md").exists());
        }
    }

    #[test]
    fn creates_history_even_inside_another_repo() {
        let outer = tempfile::tempdir().unwrap();
        git2::Repository::init(outer.path()).unwrap();
        let root = create_project_in(outer.path(), "video", None).unwrap();
        assert_eq!(history_status(&root), HistoryStatus::Enabled);
    }

    #[test]
    fn failed_create_leaves_nothing_behind() {
        let parent = tempfile::tempdir().unwrap();
        let failing = |_: &Path| -> Result<crate::git::CommitInfo> { Err(ProjectError::Other("boom".into())) };
        assert!(create_project_with(parent.path(), "video", None, failing).is_err());
        assert!(!parent.path().join("video").exists());
        assert!(create_project_in(parent.path(), "video", None).is_ok(), "a retry works");
    }
}
