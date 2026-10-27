use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;
use crate::project::ProjectState;

pub fn save_exported_video_to_root(root: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    save_exported_video_chunk_to_root(root, filename, bytes, false)
}

pub fn save_exported_video_chunk_to_root(
    root: &Path,
    filename: &str,
    chunk_bytes: &[u8],
    append: bool,
) -> Result<PathBuf, String> {
    let clean = filename.trim();
    if clean.is_empty() || clean.contains("..") || clean.contains('/') || clean.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    let out_dir = root.join("out");
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create out directory: {e}"))?;
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

#[tauri::command]
pub fn save_exported_video(
    state: State<ProjectState>,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let root = state.root().map_err(|e| e.to_string())?;
    let path = save_exported_video_to_root(&root, &filename, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_exported_video_chunk(
    state: State<ProjectState>,
    filename: String,
    chunk_base64: String,
    append: bool,
) -> Result<String, String> {
    use base64::Engine;
    let root = state.root().map_err(|e| e.to_string())?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(chunk_base64)
        .map_err(|e| format!("Invalid base64 chunk: {e}"))?;
    let path = save_exported_video_chunk_to_root(&root, &filename, &decoded, append)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_voice_recording(
    state: State<ProjectState>,
    line_id: String,
    duration: f64,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let clean_id = line_id.trim();
    if clean_id.is_empty() || clean_id.contains("..") || clean_id.contains('/') || clean_id.contains('\\') {
        return Err("Invalid line_id".to_string());
    }
    let root = state.root().map_err(|e| e.to_string())?;
    let vo_dir = root.join("assets").join("audio").join("vo");
    std::fs::create_dir_all(&vo_dir).map_err(|e| format!("Failed to create vo directory: {e}"))?;

    let audio_file = vo_dir.join(format!("{clean_id}.mp3"));
    std::fs::write(&audio_file, bytes).map_err(|e| format!("Failed to write audio: {e}"))?;

    let timing_file = vo_dir.join(format!("{clean_id}.timing.json"));
    let timing = serde_json::json!({
        "lineId": clean_id,
        "duration": duration,
        "words": []
    });
    std::fs::write(&timing_file, serde_json::to_string_pretty(&timing).unwrap())
        .map_err(|e| format!("Failed to write timing: {e}"))?;

    Ok(format!("assets/audio/vo/{clean_id}.mp3"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_save_exported_video_to_root() {
        let dir = tempdir().unwrap();
        let bytes = b"fake-mp4-data";

        let path = save_exported_video_to_root(dir.path(), "my-video.mp4", bytes).unwrap();
        assert!(path.exists());
        assert_eq!(path.parent().unwrap().file_name().unwrap(), "out");
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn test_save_exported_video_chunk_to_root() {
        let dir = tempdir().unwrap();
        let chunk1 = b"chunk-one-";
        let chunk2 = b"chunk-two";

        // First chunk without append creates and writes
        let path1 = save_exported_video_chunk_to_root(dir.path(), "stream.mp4", chunk1, false).unwrap();
        assert!(path1.exists());
        assert_eq!(std::fs::read(&path1).unwrap(), chunk1);

        // Second chunk with append appends
        let path2 = save_exported_video_chunk_to_root(dir.path(), "stream.mp4", chunk2, true).unwrap();
        assert_eq!(path1, path2);
        assert_eq!(std::fs::read(&path2).unwrap(), b"chunk-one-chunk-two");

        // Third chunk without append truncates
        let chunk3 = b"overwritten";
        let path3 = save_exported_video_chunk_to_root(dir.path(), "stream.mp4", chunk3, false).unwrap();
        assert_eq!(std::fs::read(&path3).unwrap(), chunk3);
    }

    #[test]
    fn test_rejects_malformed_filename() {
        let dir = tempdir().unwrap();
        assert!(save_exported_video_to_root(dir.path(), "", b"").is_err());
        assert!(save_exported_video_to_root(dir.path(), "../escape.mp4", b"").is_err());
        assert!(save_exported_video_to_root(dir.path(), "sub/dir.mp4", b"").is_err());
    }
}
