//! earshot (https://github.com/Leonxlnx/earshot) as an optional sound effect source: its bank of
//! sounds made in code (whooshes, pops, clicks, hits, risers, dings) renders by id in seconds, with
//! no models and no network, aimed at a move (`dur`, `apex`) or tuned (`pitch`).
//!
//! earshot is a separate Python tool and is not bundled. Install it with
//! `uv tool install "earshot @ git+https://github.com/Leonxlnx/earshot"` (needs ffmpeg); this module
//! finds the `earshot` command, runs `earshot sfx list` / `earshot sfx render`, saves the take into
//! `assets/audio/sfx/<name>.wav` (so `sfx: "<name>"` finds it) and records its attribution row.
//!
//! This file is duplicated in `apps/cli/src/earshot.rs` and `apps/desktop/src-tauri/src/earshot.rs`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

pub const REPO: &str = "https://github.com/Leonxlnx/earshot";
pub const INSTALL: &str = "uv tool install \"earshot @ git+https://github.com/Leonxlnx/earshot\"";

/// `LIOSVIDEO_EARSHOT` overrides where the command is looked for.
const ENV_OVERRIDE: &str = "LIOSVIDEO_EARSHOT";
const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RenderOptions {
    /// File name without extension (default: the bank id, "whoosh_fast/crisp" -> "whoosh_fast-crisp")
    pub name: Option<String>,
    /// Length in seconds
    pub dur: Option<f64>,
    /// When a whoosh peaks, in seconds from its start
    pub apex: Option<f64>,
    /// A note name ("E5") or Hz, for tonal sounds
    pub pitch: Option<String>,
    /// Another take of the same sound
    pub seed: Option<u64>,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub rel_path: String,
    pub filename: String,
    pub id: String,
    pub size_bytes: u64,
    /// What to write on a move: `sfx: "<name>"`
    pub usage: String,
    pub attribution_file: String,
    /// earshot's own report (the take's audit)
    pub report: String,
}

/// The `earshot` command: `$LIOSVIDEO_EARSHOT`, then PATH, then where `uv tool` and Homebrew put it.
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
    let name = if cfg!(windows) { "earshot.exe" } else { "earshot" };
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

fn not_installed() -> String {
    format!(
        "earshot is not installed. Install it with: {INSTALL} (needs uv and ffmpeg; sound bank renders need no models). \
         Or set {ENV_OVERRIDE} to the earshot command."
    )
}

/// Bank ids look like "whoosh_fast/crisp": letters, digits, `_`, `-`, `.` and `/`, never a flag.
pub fn check_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    let ok = !id.is_empty()
        && !id.starts_with(['-', '/', '.'])
        && !id.contains("..")
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/'));
    if ok {
        Ok(id.to_string())
    } else {
        Err(format!("not an earshot sound id: \"{id}\" (e.g. whoosh_fast/crisp; see earshot_sfx_list)"))
    }
}

fn check_pitch(pitch: &str) -> Result<String, String> {
    let pitch = pitch.trim();
    if !pitch.is_empty() && !pitch.starts_with('-') && pitch.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '#' | '.')) {
        Ok(pitch.to_string())
    } else {
        Err(format!("not a pitch: \"{pitch}\" (a note like E5 or C#4, or Hz like 440)"))
    }
}

/// "whoosh_fast/crisp" -> "whoosh_fast-crisp"; a given name is cleaned the same way.
pub fn take_name(id: &str, name: Option<&str>) -> String {
    let raw = name.map(str::trim).filter(|n| !n.is_empty()).unwrap_or(id);
    let raw = raw.strip_suffix(".wav").unwrap_or(raw);
    let clean: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '-' })
        .collect();
    let clean = clean.trim_matches('-').to_string();
    if clean.is_empty() {
        "earshot-sfx".to_string()
    } else {
        clean
    }
}

/// The arguments of `earshot sfx render`.
pub fn render_args(id: &str, out: &Path, opts: &RenderOptions) -> Result<Vec<String>, String> {
    let mut args = vec!["sfx".into(), "render".into(), check_id(id)?, "-o".into(), out.display().to_string()];
    if let Some(dur) = opts.dur {
        if !(dur > 0.0 && dur <= 60.0) {
            return Err(format!("dur must be between 0 and 60 seconds, got {dur}"));
        }
        args.extend(["--dur".into(), dur.to_string()]);
    }
    if let Some(apex) = opts.apex {
        if !(apex >= 0.0 && apex <= 60.0) {
            return Err(format!("apex must be between 0 and 60 seconds, got {apex}"));
        }
        args.extend(["--apex".into(), apex.to_string()]);
    }
    if let Some(pitch) = &opts.pitch {
        args.extend(["--pitch".into(), check_pitch(pitch)?]);
    }
    if let Some(seed) = opts.seed {
        args.extend(["--seed".into(), seed.to_string()]);
    }
    Ok(args)
}

async fn run(args: &[String]) -> Result<String, String> {
    let bin = binary().ok_or_else(not_installed)?;
    let child = tokio::process::Command::new(&bin)
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(TIMEOUT, child)
        .await
        .map_err(|_| format!("earshot {} took longer than {} s", args.join(" "), TIMEOUT.as_secs()))?
        .map_err(|e| format!("couldn't run {}: {e}", bin.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { format!("earshot failed ({}): {stdout}", output.status) } else { stderr })
    }
}

/// The bank's sounds (ids, lengths, peak times, knobs), optionally one kind ("whoosh", "pop", …).
pub async fn list(kind: Option<&str>) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec!["sfx".into(), "list".into()];
    if let Some(kind) = kind.map(str::trim).filter(|k| !k.is_empty()) {
        args.extend(["--kind".into(), check_id(kind)?]);
    }
    args.push("--json".into());
    let out = run(&args).await?;
    Ok(serde_json::from_str(&out).unwrap_or(serde_json::Value::String(out)))
}

/// Renders bank sound `id` into `assets/audio/sfx/<name>.wav` and records its attribution row.
pub async fn render(root: &Path, id: &str, opts: &RenderOptions) -> Result<Rendered, String> {
    let id = check_id(id)?;
    let stem = take_name(&id, opts.name.as_deref());
    let dir = root.join("assets").join("audio").join("sfx");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let mut filename = format!("{stem}.wav");
    if !opts.force && dir.join(&filename).exists() {
        filename = (2..)
            .map(|n| format!("{stem}-{n}.wav"))
            .find(|f| !dir.join(f).exists())
            .expect("a free file name");
    }
    let path = dir.join(&filename);
    let report = run(&render_args(&id, &path, opts)?).await?;
    let size_bytes = std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|_| format!("earshot finished but wrote no file at {}", path.display()))?;
    let rel_path = format!("assets/audio/sfx/{filename}");
    let attribution_file = crate::commons::record_row(
        root,
        &rel_path,
        REPO,
        "earshot (made in code)",
        "MIT",
        &format!("earshot sound bank \"{id}\", rendered from code"),
    )?;
    let name = filename.trim_end_matches(".wav");
    Ok(Rendered {
        usage: format!("sfx: \"{name}\" on a move (it resolves to {rel_path})"),
        rel_path,
        filename: filename.clone(),
        id,
        size_bytes,
        attribution_file,
        report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_names_and_pitches() {
        assert_eq!(check_id(" whoosh_fast/crisp ").unwrap(), "whoosh_fast/crisp");
        assert!(check_id("--help").is_err());
        assert!(check_id("../x").is_err());
        assert!(check_id("a b").is_err());
        assert_eq!(take_name("whoosh_fast/crisp", None), "whoosh_fast-crisp");
        assert_eq!(take_name("x", Some("hero whoosh.wav")), "hero-whoosh");
        assert_eq!(take_name("x", Some("../..")), "earshot-sfx");
        assert!(check_pitch("C#4").is_ok());
        assert!(check_pitch("-1").is_err());
    }

    #[test]
    fn builds_the_render_command() {
        let opts = RenderOptions { dur: Some(0.8), apex: Some(0.32), pitch: Some("E5".into()), seed: Some(3), ..Default::default() };
        let args = render_args("whoosh_fast/crisp", Path::new("/p/assets/audio/sfx/w.wav"), &opts).unwrap();
        assert_eq!(
            args,
            ["sfx", "render", "whoosh_fast/crisp", "-o", "/p/assets/audio/sfx/w.wav", "--dur", "0.8", "--apex", "0.32", "--pitch", "E5", "--seed", "3"]
        );
        assert!(render_args("x", Path::new("o.wav"), &RenderOptions { dur: Some(-1.0), ..Default::default() }).is_err());
    }

    /// A stand-in `earshot` that writes a WAV header where `-o` points and echoes its arguments.
    #[cfg(unix)]
    #[allow(unused_unsafe)] // set_var is unsafe in the 2024 edition (desktop), safe in 2021 (CLI)
    #[tokio::test]
    async fn renders_into_the_sfx_folder_with_an_attribution_row() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("earshot");
        std::fs::write(
            &fake,
            "#!/bin/sh\nout=\"\"\nprev=\"\"\nfor a in \"$@\"; do [ \"$prev\" = \"-o\" ] && out=\"$a\"; prev=\"$a\"; done\n\
             if [ \"$2\" = list ]; then echo '[{\"id\":\"whoosh_fast/crisp\"}]'; exit 0; fi\n\
             printf 'RIFF0000WAVE' > \"$out\"; echo \"rendered $3 clean\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        // SAFETY: only this test reads the variable
        unsafe { std::env::set_var(ENV_OVERRIDE, &fake) };

        let listed = list(Some("whoosh")).await.unwrap();
        assert_eq!(listed[0]["id"], "whoosh_fast/crisp");
        let first = render(&project, "whoosh_fast/crisp", &RenderOptions::default()).await.unwrap();
        assert_eq!(first.rel_path, "assets/audio/sfx/whoosh_fast-crisp.wav");
        assert_eq!(first.usage, "sfx: \"whoosh_fast-crisp\" on a move (it resolves to assets/audio/sfx/whoosh_fast-crisp.wav)");
        assert_eq!(first.report, "rendered whoosh_fast/crisp clean");
        let second = render(&project, "whoosh_fast/crisp", &RenderOptions::default()).await.unwrap();
        assert_eq!(second.rel_path, "assets/audio/sfx/whoosh_fast-crisp-2.wav");
        let rows = std::fs::read_to_string(project.join("assets/ATTRIBUTIONS.md")).unwrap();
        assert!(rows.contains("| `assets/audio/sfx/whoosh_fast-crisp.wav` | https://github.com/Leonxlnx/earshot | earshot (made in code) | MIT |"));

        unsafe { std::env::set_var(ENV_OVERRIDE, dir.path().join("missing")) };
        assert!(render(&project, "pop/soft", &RenderOptions::default()).await.unwrap_err().contains("uv tool install"));
        unsafe { std::env::remove_var(ENV_OVERRIDE) };
    }
}
