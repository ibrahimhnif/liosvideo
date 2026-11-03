// Project helpers copied from apps/desktop/src-tauri/src/project.rs.
//
// The Tauri-specific parts (AppHandle, State, asset protocol, watcher) are replaced
// with explicit `root` arguments so the same logic runs in the CLI.

pub mod export;
pub mod git;
pub mod keychain;
pub mod recent;
pub mod scaffold;
pub mod scene_validator;

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
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

pub type Result<T> = std::result::Result<T, ProjectError>;

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
    let mut existing = joined.as_path();
    while existing.symlink_metadata().is_err() {
        existing = existing.parent().ok_or_else(outside)?;
    }
    if !existing
        .canonicalize()
        .map_err(|_| outside())?
        .starts_with(&root)
    {
        return Err(outside());
    }
    Ok(joined)
}

fn is_composition_file(path: &Path, name: &str) -> bool {
    if name == "long.ts" || name == "short.ts" {
        return true;
    }
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    content.contains("export default") && content.contains("composition")
}

pub fn list_compositions_in(root: &Path) -> Result<Vec<String>> {
    let mut names: Vec<String> = fs::read_dir(root)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".ts") && !n.ends_with(".d.ts"))
        .filter(|n| is_composition_file(&root.join(n), n))
        .collect();
    names.sort();
    Ok(names)
}

pub fn list_code_files_in(root: &Path) -> Result<Vec<String>> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.ends_with(".ts") && !name.ends_with(".d.ts") {
                    files.push(name);
                }
            }
        }
    }
    let scenes_dir = root.join("scenes");
    if scenes_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&scenes_dir) {
            for entry in entries.flatten() {
                if let Ok(name) = entry.file_name().into_string() {
                    if name.ends_with(".ts") && !name.ends_with(".d.ts") {
                        files.push(format!("scenes/{name}"));
                    }
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

pub fn read_file_in(root: &Path, rel: &str) -> Result<String> {
    Ok(fs::read_to_string(resolve_in_project(root, rel)?)?)
}

/// Project-relative paths whose changes never affect rendering.
pub fn is_ignored(rel: &str) -> bool {
    const IGNORED: [&str; 6] = [
        ".git/",
        "out/",
        ".liosvideo/cache/",
        ".liosvideo/conversation.json",
        ".liosvideo/stats.json",
        "node_modules/",
    ];
    IGNORED
        .iter()
        .any(|prefix| rel.starts_with(prefix) || rel.contains(&format!("/{prefix}")))
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
    if !cleaned.starts_with('/') && (cleaned.starts_with("Users/") || cleaned.starts_with("home/"))
    {
        cleaned = format!("/{cleaned}");
    }
    PathBuf::from(cleaned)
}

pub async fn git_job<T: Send + 'static>(
    f: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ProjectError::Other(format!("git task failed: {e}")))?
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    let content =
        serde_json::to_string_pretty(stats).map_err(|e| ProjectError::Other(e.to_string()))?;
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
    stats.total_cost_usd =
        ((stats.tts.total_cost_usd + stats.tokens.total_cost_usd) * 100000.0).round() / 100000.0;
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
    stats.tokens.total_cost_usd =
        ((stats.tokens.total_cost_usd + cost) * 100000.0).round() / 100000.0;
    stats.total_cost_usd =
        ((stats.tts.total_cost_usd + stats.tokens.total_cost_usd) * 100000.0).round() / 100000.0;
    save_stats_in(root, &stats)?;
    Ok(stats)
}

pub fn load_conversation_in(root: &Path) -> Result<Option<String>> {
    let path = conversation_file(root);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(path)?))
}

pub fn save_conversation_in(root: &Path, content: &str) -> Result<()> {
    let lios_dir = root.join(".liosvideo");
    fs::create_dir_all(&lios_dir)?;
    fs::write(conversation_file(root), content)?;
    Ok(())
}

pub fn get_vo_timings_in(project_root: &Path) -> HashMap<String, serde_json::Value> {
    let vo_dir = project_root.join("assets").join("audio").join("vo");
    let mut timings = HashMap::new();

    if vo_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(vo_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file()
                    && path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|s| s.ends_with(".timing.json"))
                {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            let line_id = json
                                .get("lineId")
                                .or_else(|| json.get("line_id"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| {
                                    let fname =
                                        path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                                    fname.trim_end_matches(".timing").to_string()
                                });
                            timings.insert(line_id, json);
                        }
                    }
                }
            }
        }
    }
    timings
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImageAsset {
    pub rel_path: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVideoAsset {
    pub rel_path: String,
    pub filename: String,
    pub size_bytes: u64,
}

fn sanitize_asset_name(name: &str, fallback: &str) -> String {
    let raw_name = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(fallback);
    let clean: String = raw_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

fn uniquify(dir: &Path, name: &str, fallback_stem: &str, fallback_ext: &str) -> String {
    let target = dir.join(name);
    if !target.exists() {
        return name.to_string();
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(fallback_stem);
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or(fallback_ext);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{stem}-{timestamp}.{ext}")
}

pub async fn save_image_asset_in(
    root: &Path,
    name: &str,
    base64_data: &str,
) -> Result<SavedImageAsset> {
    let images_dir = root.join("assets").join("images");
    tokio::fs::create_dir_all(&images_dir)
        .await
        .map_err(|e| ProjectError::Other(format!("Failed to create assets/images: {e}")))?;

    let clean_name = sanitize_asset_name(name, "image.png");
    let final_name = uniquify(&images_dir, &clean_name, "image", "png");

    let pure_base64 = if let Some(idx) = base64_data.find(";base64,") {
        &base64_data[idx + 8..]
    } else {
        base64_data
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(pure_base64.trim())
        .map_err(|e| ProjectError::Other(format!("Invalid base64 image data: {e}")))?;

    let final_path = images_dir.join(&final_name);
    tokio::fs::write(&final_path, bytes)
        .await
        .map_err(|e| ProjectError::Other(format!("Failed to write image file: {e}")))?;

    Ok(SavedImageAsset {
        rel_path: format!("assets/images/{final_name}"),
        filename: final_name,
    })
}

pub async fn save_video_asset_in(
    root: &Path,
    name: &str,
    base64_data: Option<&str>,
    source_path: Option<&str>,
) -> Result<SavedVideoAsset> {
    let video_dir = root.join("assets").join("video");
    tokio::fs::create_dir_all(&video_dir)
        .await
        .map_err(|e| ProjectError::Other(format!("Failed to create assets/video: {e}")))?;

    let clean_name = sanitize_asset_name(name, "video.mp4");
    let final_name = uniquify(&video_dir, &clean_name, "video", "mp4");
    let final_path = video_dir.join(&final_name);

    let size_bytes = if let Some(src) = source_path {
        let src_path = Path::new(src);
        if !src_path.exists() {
            return Err(ProjectError::Other(format!(
                "Source video path does not exist: {src}"
            )));
        }
        tokio::fs::copy(src_path, &final_path)
            .await
            .map_err(|e| ProjectError::Other(format!("Failed to copy video file: {e}")))?
    } else if let Some(b64) = base64_data {
        let pure_base64 = if let Some(idx) = b64.find(";base64,") {
            &b64[idx + 8..]
        } else {
            b64
        };
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(pure_base64.trim())
            .map_err(|e| ProjectError::Other(format!("Invalid base64 video data: {e}")))?;
        let len = bytes.len() as u64;
        tokio::fs::write(&final_path, bytes)
            .await
            .map_err(|e| ProjectError::Other(format!("Failed to write video file: {e}")))?;
        len
    } else {
        return Err(ProjectError::Other(
            "Neither base64Data nor sourcePath provided".into(),
        ));
    };

    Ok(SavedVideoAsset {
        rel_path: format!("assets/video/{final_name}"),
        filename: final_name,
        size_bytes,
    })
}

/// The non-Tauri part of opening: canonical root, history status, and a "Manual edit" commit.
pub fn prepare_open(root: &Path) -> Result<(PathBuf, git::HistoryStatus, Option<git::CommitInfo>)> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(ProjectError::Other(format!(
            "{} is not a folder",
            root.display()
        )));
    }
    let status = git::history_status(&root);
    let auto = status == git::HistoryStatus::Enabled && git::can_auto_commit(&root);
    let commit = if auto {
        git::commit_all(&root, git::MANUAL_EDIT)?
    } else {
        None
    };
    Ok((root, status, commit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_paths() {
        let p1 = normalize_project_path("Users/hanif/Labs/personal/Perkenalan%20Product");
        assert_eq!(
            p1,
            PathBuf::from("/Users/hanif/Labs/personal/Perkenalan Product")
        );
        let p2 = normalize_project_path("file:///Users/hanif/Labs/test%20folder");
        assert_eq!(p2, PathBuf::from("/Users/hanif/Labs/test folder"));
    }

    #[test]
    fn rejects_escapes() {
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve_in_project(dir.path(), "../escape").is_err());
        assert!(resolve_in_project(dir.path(), "/etc/passwd").is_err());
        assert!(resolve_in_project(dir.path(), "assets/a.png").is_ok());
    }

    #[test]
    fn lists_compositions_and_code_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        for f in [
            "long.ts",
            "short.ts",
            "custom.ts",
            "types.d.ts",
            "scenes/a.ts",
        ] {
            fs::write(dir.path().join(f), "export default composition({})").unwrap();
        }
        let comps = list_compositions_in(dir.path()).unwrap();
        assert!(comps.contains(&"long.ts".to_string()));
        assert!(!comps.iter().any(|c| c.ends_with(".d.ts")));
        let files = list_code_files_in(dir.path()).unwrap();
        assert!(files.contains(&"scenes/a.ts".to_string()));
    }

    #[test]
    fn stats_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let stats = record_tts_usage_in(dir.path(), "l1", "elevenlabs", "v", "hello").unwrap();
        assert_eq!(stats.tts.total_characters, 5);
        let loaded = load_stats_in(dir.path());
        assert_eq!(loaded, stats);
    }
}
