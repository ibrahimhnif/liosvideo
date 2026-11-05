use std::fs;
use std::path::{Path, PathBuf};

use super::ProjectError;

type Result<T> = std::result::Result<T, ProjectError>;

const SHARED_TEMPLATES: [(&str, &str); 4] = [
    ("AGENTS.md", include_str!("templates/AGENTS.md")),
    (".gitignore", include_str!("templates/gitignore")),
    (
        ".liosvideo/project.json",
        include_str!("templates/project.json"),
    ),
    (
        ".agents/skills/liosvideo/SKILL.md",
        include_str!("templates/skills/liosvideo/SKILL.md"),
    ),
];

const BLANK_TEMPLATES: [(&str, &str); 4] = [
    ("long.ts", include_str!("templates/long.ts")),
    ("short.ts", include_str!("templates/short.ts")),
    ("scenes/intro.ts", include_str!("templates/scenes/intro.ts")),
    ("script.md", include_str!("templates/script.md")),
];

const MINIMAL_DEV_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("templates/minimal-dev/theme.ts")),
    (
        "scenes/intro.ts",
        include_str!("templates/minimal-dev/scenes/intro.ts"),
    ),
    (
        "scenes/main.ts",
        include_str!("templates/minimal-dev/scenes/main.ts"),
    ),
    (
        "scenes/outro.ts",
        include_str!("templates/minimal-dev/scenes/outro.ts"),
    ),
    ("long.ts", include_str!("templates/minimal-dev/long.ts")),
    ("short.ts", include_str!("templates/minimal-dev/short.ts")),
    ("script.md", include_str!("templates/minimal-dev/script.md")),
];

const PRODUCT_3D_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("templates/product-3d/theme.ts")),
    (
        "scenes/intro.ts",
        include_str!("templates/product-3d/scenes/intro.ts"),
    ),
    (
        "scenes/main.ts",
        include_str!("templates/product-3d/scenes/main.ts"),
    ),
    (
        "scenes/outro.ts",
        include_str!("templates/product-3d/scenes/outro.ts"),
    ),
    ("long.ts", include_str!("templates/product-3d/long.ts")),
    ("short.ts", include_str!("templates/product-3d/short.ts")),
    ("script.md", include_str!("templates/product-3d/script.md")),
];

const KINETIC_SHORT_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("templates/kinetic-short/theme.ts")),
    (
        "scenes/intro.ts",
        include_str!("templates/kinetic-short/scenes/intro.ts"),
    ),
    (
        "scenes/main.ts",
        include_str!("templates/kinetic-short/scenes/main.ts"),
    ),
    (
        "scenes/outro.ts",
        include_str!("templates/kinetic-short/scenes/outro.ts"),
    ),
    ("long.ts", include_str!("templates/kinetic-short/long.ts")),
    ("short.ts", include_str!("templates/kinetic-short/short.ts")),
    (
        "script.md",
        include_str!("templates/kinetic-short/script.md"),
    ),
];

const SAAS_LAUNCH_TEMPLATES: [(&str, &str); 7] = [
    ("theme.ts", include_str!("templates/saas-launch/theme.ts")),
    (
        "scenes/intro.ts",
        include_str!("templates/saas-launch/scenes/intro.ts"),
    ),
    (
        "scenes/main.ts",
        include_str!("templates/saas-launch/scenes/main.ts"),
    ),
    (
        "scenes/outro.ts",
        include_str!("templates/saas-launch/scenes/outro.ts"),
    ),
    ("long.ts", include_str!("templates/saas-launch/long.ts")),
    ("short.ts", include_str!("templates/saas-launch/short.ts")),
    ("script.md", include_str!("templates/saas-launch/script.md")),
];

const ASSET_DIRS: [&str; 5] = [
    "assets/images",
    "assets/video",
    "assets/fonts",
    "assets/audio/vo",
    "assets/audio/music",
];

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

/// The ten animation styles from `examples/style-lab`, in catalog order: (id, title).
pub const STYLES: [(&str, &str); 10] = [
    ("pixel-art", "Pixel Art"),
    ("chalkboard", "Chalkboard"),
    ("glow-sketch", "Glow Sketch"),
    ("ps2-lowpoly", "PS2 Style"),
    ("comic", "Comic Art"),
    ("flat-vector", "Flat Vector"),
    ("minimal-mono", "Minimal Mono (Dan Koe style)"),
    ("cgi-motion", "CGI Motion"),
    ("brick", "Brick Build (LEGO-like)"),
    ("explainer-3d", "3D Explainer (ZackD Films style)"),
];

/// A style's files, embedded from `examples/style-lab`: [module, doc, demo scene].
macro_rules! style_kit {
    ($id:literal) => {
        [
            (concat!("styles/", $id, ".ts"), include_str!(concat!("../../../../examples/style-lab/styles/", $id, ".ts"))),
            (concat!(".agents/skills/liosvideo/styles/", $id, ".md"), include_str!(concat!("../../../../examples/style-lab/docs/", $id, ".md"))),
            (concat!("scenes/", $id, ".ts"), include_str!(concat!("../../../../examples/style-lab/scenes/", $id, ".ts"))),
        ]
    };
}

const STYLE_KITS: [[(&str, &str); 3]; 10] = [
    style_kit!("pixel-art"),
    style_kit!("chalkboard"),
    style_kit!("glow-sketch"),
    style_kit!("ps2-lowpoly"),
    style_kit!("comic"),
    style_kit!("flat-vector"),
    style_kit!("minimal-mono"),
    style_kit!("cgi-motion"),
    style_kit!("brick"),
    style_kit!("explainer-3d"),
];

/// `None` or blank means no style; an unknown id is an error.
pub fn validate_style_id(style: Option<&str>) -> Result<Option<&'static str>> {
    match style.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(id) => STYLES
            .iter()
            .find(|(known, _)| *known == id)
            .map(|(known, _)| Some(*known))
            .ok_or_else(|| ProjectError::Other(format!("Unknown style: {id}"))),
    }
}

/// `styles/<id>.ts`, `.agents/skills/liosvideo/styles/<id>.md` and the demo scene (`scenes/<id>.ts`).
pub fn style_files(id: &str) -> Vec<(&'static str, &'static str)> {
    STYLES.iter().position(|(known, _)| *known == id).map(|i| STYLE_KITS[i].to_vec()).unwrap_or_default()
}

/// Writes the style module and doc where they are missing (never overwrites) and records
/// `"style"` in `.liosvideo/project.json`, keeping its other keys. Returns the paths it wrote.
pub fn install_style(root: &Path, id: &str) -> Result<Vec<String>> {
    let id = validate_style_id(Some(id))?.ok_or_else(|| ProjectError::Other("No style given".into()))?;
    let mut written = Vec::new();
    for (rel, content) in style_files(id).into_iter().filter(|(rel, _)| !rel.starts_with("scenes/")) {
        let path = root.join(rel);
        if path.exists() {
            continue;
        }
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(path, content)?;
        written.push(rel.to_string());
    }
    let meta = root.join(".liosvideo/project.json");
    let mut json: serde_json::Value = match fs::read_to_string(&meta) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| ProjectError::Other(format!("Invalid .liosvideo/project.json: {e}")))?,
        Err(_) => serde_json::json!({ "version": 1 }),
    };
    let Some(obj) = json.as_object_mut() else {
        return Err(ProjectError::Other("Invalid .liosvideo/project.json: not an object".into()));
    };
    obj.insert("style".into(), id.into());
    fs::create_dir_all(root.join(".liosvideo"))?;
    let text = serde_json::to_string_pretty(&json).map_err(|e| ProjectError::Other(e.to_string()))?;
    fs::write(meta, text + "\n")?;
    Ok(written)
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
pub fn create_project_in(parent: &Path, name: &str, template: Option<&str>, style: Option<&str>) -> Result<PathBuf> {
    create_project_with(parent, name, template, style, super::git::init_history)
}

/// `create_project_in` with the history step injectable; on any failure the new folder is removed.
pub fn create_project_with(
    parent: &Path,
    name: &str,
    template: Option<&str>,
    style: Option<&str>,
    init: impl Fn(&Path) -> Result<super::git::CommitInfo>,
) -> Result<PathBuf> {
    validate_project_name(name)?;
    let template_id = validate_template_id(template)?;
    let style = validate_style_id(style)?;
    let root = parent.join(name);
    if root.exists() {
        return Err(ProjectError::Other(format!(
            "{} already exists",
            root.display()
        )));
    }
    fs::create_dir(&root)?;
    // only this call created `root`, so removing it on failure can't touch the user's files
    let result = populate(&root, template_id, style, init);
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
    }
    result
}

fn populate(
    root: &Path,
    template_id: &str,
    style: Option<&str>,
    init: impl Fn(&Path) -> Result<super::git::CommitInfo>,
) -> Result<PathBuf> {
    for (rel, content) in template_files(template_id) {
        let path = root.join(rel);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(path, content)?;
    }
    if let Some(id) = style {
        install_style(root, id)?;
        // a blank project opens on the style's demo scene instead of the placeholder intro
        if template_id == "blank" {
            if let Some((_, scene)) = style_files(id).into_iter().find(|(rel, _)| rel.starts_with("scenes/")) {
                fs::write(root.join("scenes/intro.ts"), scene)?;
            }
        }
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
    use crate::project::git::{history, history_status, HistoryStatus};
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
        assert_eq!(
            validate_template_id(Some("minimal-dev")).unwrap(),
            "minimal-dev"
        );
        assert_eq!(
            validate_template_id(Some("product-3d")).unwrap(),
            "product-3d"
        );
        assert_eq!(
            validate_template_id(Some("kinetic-short")).unwrap(),
            "kinetic-short"
        );
        assert_eq!(
            validate_template_id(Some("saas-launch")).unwrap(),
            "saas-launch"
        );
        assert!(validate_template_id(Some("unknown-xyz")).is_err());
    }

    #[test]
    fn refuses_existing_folder_and_leaves_it_untouched() {
        let parent = tempfile::tempdir().unwrap();
        let existing = parent.path().join("video");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("keep.txt"), "mine").unwrap();
        assert!(create_project_in(parent.path(), "video", None, None).is_err());
        let names: Vec<_> = fs::read_dir(&existing)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec!["keep.txt"]);
        assert_eq!(
            fs::read_to_string(existing.join("keep.txt")).unwrap(),
            "mine"
        );
    }

    #[test]
    fn creates_layout_and_initial_commit() {
        let parent = tempfile::tempdir().unwrap();
        let root = create_project_in(parent.path(), "php2shell", None, None).unwrap();
        assert_eq!(
            root,
            parent.path().join("php2shell").canonicalize().unwrap()
        );
        for rel in [
            "long.ts",
            "short.ts",
            "scenes/intro.ts",
            "script.md",
            "AGENTS.md",
            ".gitignore",
            ".liosvideo/project.json",
            ".agents/skills/liosvideo/SKILL.md",
            "assets/images",
            "assets/video",
            "assets/fonts",
            "assets/audio/vo",
            "assets/audio/music",
        ] {
            assert!(root.join(rel).exists(), "missing {rel}");
        }
        let agents = fs::read_to_string(root.join("AGENTS.md")).unwrap();
        for link in ["CLAUDE.md", "GEMINI.md"] {
            assert!(fs::symlink_metadata(root.join(link))
                .unwrap()
                .file_type()
                .is_symlink());
            assert_eq!(
                fs::read_link(root.join(link)).unwrap(),
                Path::new("AGENTS.md")
            );
            assert_eq!(fs::read_to_string(root.join(link)).unwrap(), agents);
        }
        assert_eq!(history_status(&root), HistoryStatus::Enabled);
        assert_eq!(history(&root, 10).unwrap().len(), 1);
        assert!(
            crate::project::git::commit_all(&root, "x")
                .unwrap()
                .is_none(),
            "everything is committed"
        );
    }

    #[test]
    fn creates_archetype_templates() {
        let parent = tempfile::tempdir().unwrap();
        for archetype in ["minimal-dev", "product-3d", "kinetic-short", "saas-launch"] {
            let root = create_project_in(parent.path(), archetype, Some(archetype), None).unwrap();
            assert!(
                root.join("theme.ts").exists(),
                "{archetype} missing theme.ts"
            );
            assert!(
                root.join("scenes/intro.ts").exists(),
                "{archetype} missing intro.ts"
            );
            assert!(
                root.join("scenes/main.ts").exists(),
                "{archetype} missing main.ts"
            );
            assert!(
                root.join("scenes/outro.ts").exists(),
                "{archetype} missing outro.ts"
            );
            assert!(root.join("long.ts").exists(), "{archetype} missing long.ts");
            assert!(
                root.join("short.ts").exists(),
                "{archetype} missing short.ts"
            );
            assert!(
                root.join("script.md").exists(),
                "{archetype} missing script.md"
            );
            assert!(root.join(".agents/skills/liosvideo/SKILL.md").exists());
        }
    }

    #[test]
    fn creates_history_even_inside_another_repo() {
        let outer = tempfile::tempdir().unwrap();
        git2::Repository::init(outer.path()).unwrap();
        let root = create_project_in(outer.path(), "video", None, None).unwrap();
        assert_eq!(history_status(&root), HistoryStatus::Enabled);
    }

    #[test]
    fn failed_create_leaves_nothing_behind() {
        let parent = tempfile::tempdir().unwrap();
        let failing = |_: &Path| -> Result<crate::project::git::CommitInfo> {
            Err(ProjectError::Other("boom".into()))
        };
        assert!(create_project_with(parent.path(), "video", None, None, failing).is_err());
        assert!(!parent.path().join("video").exists());
        assert!(
            create_project_in(parent.path(), "video", None, None).is_ok(),
            "a retry works"
        );
    }

    #[test]
    fn agents_md_allows_three_imports() {
        let agents = SHARED_TEMPLATES.iter().find(|(rel, _)| *rel == "AGENTS.md").unwrap().1;
        assert!(!agents.contains("Only import `liosvideo` and relative project files."));
        assert!(agents.contains("Only import `liosvideo`, `three` and relative project files."));
    }

    #[test]
    fn validates_styles() {
        assert_eq!(STYLES.len(), 10);
        for (id, _) in STYLES {
            assert_eq!(validate_style_id(Some(id)).unwrap(), Some(id));
        }
        assert_eq!(validate_style_id(None).unwrap(), None);
        assert_eq!(validate_style_id(Some("")).unwrap(), None);
        let err = validate_style_id(Some("lego")).unwrap_err().to_string();
        assert!(err.contains("Unknown style: lego"), "{err}");
    }

    #[test]
    fn blank_with_style_uses_the_style_scene() {
        let parent = tempfile::tempdir().unwrap();
        let root = create_project_in(parent.path(), "video", Some("blank"), Some("comic")).unwrap();
        assert!(root.join("styles/comic.ts").exists());
        assert!(root.join(".agents/skills/liosvideo/styles/comic.md").exists());
        let scene = style_files("comic").into_iter().find(|(rel, _)| *rel == "scenes/comic.ts").unwrap().1;
        assert_eq!(fs::read_to_string(root.join("scenes/intro.ts")).unwrap(), scene);
        let meta: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join(".liosvideo/project.json")).unwrap()).unwrap();
        assert_eq!(meta["style"], "comic");
        assert_eq!(meta["version"], 1);
        assert!(crate_commit_all_clean(&root), "the style files are in the initial commit");
    }

    #[test]
    fn template_with_style_keeps_template_scenes() {
        let parent = tempfile::tempdir().unwrap();
        let root = create_project_in(parent.path(), "video", Some("minimal-dev"), Some("pixel-art")).unwrap();
        let main = template_files("minimal-dev").into_iter().find(|(rel, _)| *rel == "scenes/main.ts").unwrap().1;
        assert_eq!(fs::read_to_string(root.join("scenes/main.ts")).unwrap(), main);
        assert!(root.join("styles/pixel-art.ts").exists());
    }

    #[test]
    fn install_style_never_overwrites() {
        let parent = tempfile::tempdir().unwrap();
        let root = create_project_in(parent.path(), "video", None, Some("comic")).unwrap();
        fs::write(root.join("styles/comic.ts"), "// mine").unwrap();
        fs::remove_file(root.join(".agents/skills/liosvideo/styles/comic.md")).unwrap();
        let written = install_style(&root, "comic").unwrap();
        assert_eq!(written, vec![".agents/skills/liosvideo/styles/comic.md".to_string()]);
        assert_eq!(fs::read_to_string(root.join("styles/comic.ts")).unwrap(), "// mine");
        install_style(&root, "brick").unwrap();
        let meta: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join(".liosvideo/project.json")).unwrap()).unwrap();
        assert_eq!(meta["style"], "brick");
        assert_eq!(meta["version"], 1);
        assert!(install_style(&root, "lego").is_err());
    }

    fn crate_commit_all_clean(root: &Path) -> bool {
        super::super::git::commit_all(root, "x").unwrap().is_none()
    }
}
