use std::path::{Path, PathBuf};
use tauri::State;
use crate::project::ProjectState;

pub fn save_exported_video_to_root(root: &Path, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let clean = filename.trim();
    if clean.is_empty() || clean.contains("..") || clean.contains('/') || clean.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    let out_dir = root.join("out");
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create out directory: {e}"))?;
    let target_file = out_dir.join(clean);
    std::fs::write(&target_file, bytes).map_err(|e| format!("Failed to write export file: {e}"))?;
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
    fn test_rejects_malformed_filename() {
        let dir = tempdir().unwrap();
        assert!(save_exported_video_to_root(dir.path(), "", b"").is_err());
        assert!(save_exported_video_to_root(dir.path(), "../escape.mp4", b"").is_err());
        assert!(save_exported_video_to_root(dir.path(), "sub/dir.mp4", b"").is_err());
    }
}
