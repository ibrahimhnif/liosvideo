//! `video_matte` in the desktop app runs the `liosvideo` CLI (`liosvideo asset matte`), which carries
//! the matting model and its GPU backend; the app itself stays small. The CLI writes the packed
//! cut-out `<name>.matte.mp4` that `video({ matte: true })` plays.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

pub const ENV_OVERRIDE: &str = "LIOSVIDEO_CLI";
const INSTALL: &str =
    "curl -fsSL https://raw.githubusercontent.com/ibrahimhnif/liosvideo/main/install.sh | sh";
/// A long clip at `best` quality takes minutes; a stuck run still ends.
const TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// The `liosvideo` CLI: `LIOSVIDEO_CLI`, else PATH and the usual install folders.
pub fn binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(ENV_OVERRIDE).map(PathBuf::from) {
        return path.is_file().then_some(path);
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    let name = if cfg!(windows) { "liosvideo.exe" } else { "liosvideo" };
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

fn not_installed() -> String {
    format!(
        "Cutting people out of videos needs the liosvideo CLI (it carries the matting model). \
         Install it with: {INSTALL}  — or set {ENV_OVERRIDE} to the liosvideo command."
    )
}

/// A project video path: relative, inside the project, never a flag.
pub fn check_video(video: &str) -> Result<String, String> {
    let video = video.trim().trim_start_matches("./");
    if video.is_empty() || video.starts_with('-') || video.starts_with('/') || video.contains("..") {
        return Err(format!("\"{video}\" must be a project path like assets/video/talk.mp4"));
    }
    Ok(video.to_string())
}

pub fn quality(q: Option<&str>) -> Result<&'static str, String> {
    match q.unwrap_or("fast") {
        "fast" => Ok("fast"),
        "balanced" => Ok("balanced"),
        "best" => Ok("best"),
        other => Err(format!("unknown quality \"{other}\"; use fast, balanced or best")),
    }
}

pub fn args(root: &Path, video: &str, quality: &str, force: bool) -> Vec<String> {
    let mut a = vec![
        "asset".to_string(),
        "matte".to_string(),
        video.to_string(),
        "--quality".to_string(),
        quality.to_string(),
        "--project".to_string(),
        root.to_string_lossy().to_string(),
    ];
    if force {
        a.push("--force".to_string());
    }
    a
}

/// Runs `liosvideo asset matte` and returns its JSON result (`relPath`, `frames`, `usage`, …).
pub async fn matte(root: &Path, video: &str, quality_arg: Option<&str>, force: bool) -> Result<Value, String> {
    let video = check_video(video)?;
    let quality = quality(quality_arg)?;
    if !root.join(&video).is_file() {
        return Err(format!("video not found: {video}"));
    }
    let bin = binary().ok_or_else(not_installed)?;
    let child = tokio::process::Command::new(&bin)
        .args(args(root, &video, quality, force))
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(TIMEOUT, child)
        .await
        .map_err(|_| "liosvideo asset matte took over an hour and was stopped".to_string())?
        .map_err(|e| format!("could not run {}: {e}", bin.display()))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        if detail.contains("unrecognized subcommand") {
            return Err(format!("the installed liosvideo CLI is too old for matting; update it with: {INSTALL}"));
        }
        return Err(format!("liosvideo asset matte failed: {detail}"));
    }
    // the result is the JSON object printed last
    let start = stdout.find('{').ok_or_else(|| format!("unexpected output from liosvideo: {stdout}"))?;
    serde_json::from_str(&stdout[start..]).map_err(|e| format!("unexpected output from liosvideo: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_paths_outside_the_project_and_flags() {
        assert_eq!(check_video("./assets/video/a.mp4").unwrap(), "assets/video/a.mp4");
        assert!(check_video("--force").is_err());
        assert!(check_video("/etc/passwd").is_err());
        assert!(check_video("assets/../../x.mp4").is_err());
        assert!(quality(Some("ultra")).is_err());
        assert_eq!(quality(None).unwrap(), "fast");
    }

    #[test]
    fn builds_the_cli_call() {
        let a = args(Path::new("/p"), "assets/video/a.mp4", "best", true);
        assert_eq!(a, ["asset", "matte", "assets/video/a.mp4", "--quality", "best", "--project", "/p", "--force"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_the_cli_and_reads_its_json() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets/video")).unwrap();
        std::fs::write(dir.path().join("assets/video/a.mp4"), b"x").unwrap();
        let stub = dir.path().join("liosvideo");
        std::fs::write(
            &stub,
            "#!/bin/sh\necho \"$@\" > \"$(dirname \"$0\")/args.txt\"\nprintf '{\\n  \"relPath\": \"assets/video/a.matte.mp4\",\\n  \"made\": true\\n}\\n'\n",
        )
        .unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
        #[allow(unused_unsafe)]
        unsafe {
            std::env::set_var(ENV_OVERRIDE, &stub)
        };
        let out = matte(dir.path(), "assets/video/a.mp4", None, false).await.unwrap();
        assert_eq!(out["relPath"], "assets/video/a.matte.mp4");
        let called = std::fs::read_to_string(dir.path().join("args.txt")).unwrap();
        assert!(called.starts_with("asset matte assets/video/a.mp4 --quality fast --project"));
        assert!(matte(dir.path(), "assets/video/missing.mp4", None, false).await.unwrap_err().contains("not found"));
    }
}
