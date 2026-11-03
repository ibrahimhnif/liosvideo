// Copied from apps/desktop/src-tauri/src/export.rs (pure helpers only).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{ProjectError, Result};

pub fn save_exported_video_to_root(
    root: &Path,
    filename: &str,
    bytes: &[u8],
) -> std::result::Result<PathBuf, String> {
    save_exported_video_chunk_to_root(root, filename, bytes, false)
}

pub fn save_exported_video_chunk_to_root(
    root: &Path,
    filename: &str,
    chunk_bytes: &[u8],
    append: bool,
) -> std::result::Result<PathBuf, String> {
    let clean = filename.trim();
    if clean.is_empty() || clean.contains("..") || clean.contains('/') || clean.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    let out_dir = root.join("out");
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create out directory: {e}"))?;
    let target_file = out_dir.join(clean);

    let mut file = if append {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target_file)
            .map_err(|e| format!("Failed to open export file for appending: {e}"))?
    } else {
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&target_file)
            .map_err(|e| format!("Failed to create export file: {e}"))?
    };

    file.write_all(chunk_bytes)
        .map_err(|e| format!("Failed to write export file chunk: {e}"))?;

    Ok(target_file)
}

pub fn save_voice_recording_in(
    root: &Path,
    line_id: &str,
    duration: f64,
    bytes: &[u8],
) -> Result<String> {
    let clean_id = line_id.trim();
    if clean_id.is_empty()
        || clean_id.contains("..")
        || clean_id.contains('/')
        || clean_id.contains('\\')
    {
        return Err(ProjectError::Other("Invalid line_id".to_string()));
    }
    let vo_dir = root.join("assets").join("audio").join("vo");
    std::fs::create_dir_all(&vo_dir)?;

    let audio_file = vo_dir.join(format!("{clean_id}.mp3"));
    std::fs::write(&audio_file, bytes)?;

    let timing_file = vo_dir.join(format!("{clean_id}.timing.json"));
    let timing = serde_json::json!({
        "lineId": clean_id,
        "duration": duration,
        "words": []
    });
    std::fs::write(&timing_file, serde_json::to_string_pretty(&timing).unwrap())?;

    Ok(format!("assets/audio/vo/{clean_id}.mp3"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_appends_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let path1 =
            save_exported_video_chunk_to_root(dir.path(), "stream.mp4", b"one", false).unwrap();
        let path2 =
            save_exported_video_chunk_to_root(dir.path(), "stream.mp4", b"two", true).unwrap();
        assert_eq!(path1, path2);
        assert_eq!(std::fs::read(&path2).unwrap(), b"onetwo");
    }

    #[test]
    fn rejects_unsafe_names() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_exported_video_to_root(dir.path(), "../escape.mp4", b"").is_err());
        assert!(save_exported_video_to_root(dir.path(), "sub/dir.mp4", b"").is_err());
    }

    #[test]
    fn saves_voice_recording_and_timing() {
        let dir = tempfile::tempdir().unwrap();
        let rel = save_voice_recording_in(dir.path(), "intro-1", 1.5, b"mp3").unwrap();
        assert_eq!(rel, "assets/audio/vo/intro-1.mp3");
        assert!(dir
            .path()
            .join("assets/audio/vo/intro-1.timing.json")
            .exists());
    }
}
