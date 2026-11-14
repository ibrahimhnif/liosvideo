//! Short clips cut from a long project video, ready for `scene({ vo: [id] })` and `clipVideo`.
//!
//! `video_clip` cuts `from`..`to` of a video into `assets/video/clips/<id>.mp4` with ffmpeg: H.264
//! without B-frames (what the renderer decodes) with the sound in the same file. Its words, taken
//! from the long video's transcript and moved to clip time, go into `assets/audio/vo/<id>.timing.json`
//! with `src` (the clip file, played as the line's audio) and `clip` (for `clipVideo`), so the
//! scene's length, the audio, `captions()` and `word()` all work as for a voice-over line.
//!
//! This file is duplicated in `apps/cli/src/clips.rs` and `apps/desktop/src-tauri/src/clips.rs`.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::transcript::{self, Word};

const ENV_OVERRIDE: &str = "LIOSVIDEO_FFMPEG";
const TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Clips longer than this are refused: they are for shorts, and a typo in `to` would cut an hour.
pub const MAX_SECONDS: f64 = 600.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clipped {
    pub id: String,
    /// The cut clip, `assets/video/clips/<id>.mp4`
    pub rel_path: String,
    pub timing: String,
    /// Seconds in the long video, after snapping to word edges
    pub from: f64,
    pub to: f64,
    pub duration: f64,
    pub words: usize,
    pub text: String,
    pub usage: String,
}

/// Clip ids: lowercase letters, digits, `-` and `_` (they name files and VO lines).
pub fn check_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    let ok = !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_'));
    if ok { Ok(id.to_string()) } else { Err(format!("clip id \"{id}\" must be lowercase letters, digits, - or _ (e.g. clip-01)")) }
}

/// Moves `from` back to the start of the word it falls in (or the next word), less a breath, and
/// `to` forward to the end of the word it falls in, plus a little room, so no word is cut off.
pub fn snap(words: &[Word], from: f64, to: f64) -> (f64, f64) {
    let first = words.iter().find(|w| w.end > from).filter(|w| w.start < to);
    let last = words.iter().rev().find(|w| w.start < to).filter(|w| w.end > from);
    match (first, last) {
        (Some(a), Some(b)) => ((a.start - 0.12).max(0.0), b.end + 0.2),
        _ => (from.max(0.0), to),
    }
}

/// The words between `from` and `to`, in clip time.
pub fn clip_words(words: &[Word], from: f64, to: f64) -> Vec<Word> {
    let round = |x: f64| (x * 1000.0).round() / 1000.0;
    words
        .iter()
        .filter(|w| w.start >= from - 0.05 && w.end <= to + 0.05)
        .map(|w| Word { word: w.word.clone(), start: round((w.start - from).max(0.0)), end: round((w.end - from).min(to - from)) })
        .collect()
}

pub fn cut_args(src: &Path, from: f64, duration: f64, out: &Path) -> Vec<String> {
    vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-ss".into(),
        format!("{from:.3}"),
        "-i".into(),
        src.display().to_string(),
        "-t".into(),
        format!("{duration:.3}"),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "18".into(),
        "-bf".into(),
        "0".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        out.display().to_string(),
    ]
}

pub fn usage(id: &str) -> String {
    format!(
        "scene(\"{id}\", {{ vo: [\"{id}\"], pad: 0 }}, ({{ root, width, height }}) => {{\n  \
         clipVideo(root, \"{id}\", {{ width, height }});\n  \
         captions(root, {{ lines: [\"{id}\"] }});\n}})"
    )
}

pub struct ClipOptions {
    /// Move the ends to word edges (default true)
    pub snap: bool,
    pub force: bool,
}

/// Cuts `from`..`to` (seconds) of project video `video` into clip `id`.
pub async fn make_clip(root: &Path, video: &str, from: f64, to: f64, id: &str, opts: &ClipOptions) -> Result<Clipped, String> {
    let id = check_id(id)?;
    let video = video.trim().trim_start_matches("./").to_string();
    if video.starts_with('-') || video.starts_with('/') || video.contains("..") || !root.join(&video).is_file() {
        return Err(format!("video not found: {video}"));
    }
    if !(from.is_finite() && to.is_finite() && from >= 0.0 && to > from) {
        return Err(format!("from ({from}) must be before to ({to})"));
    }
    if to - from > MAX_SECONDS {
        return Err(format!("a clip is at most {MAX_SECONDS} s; {from}..{to} is {:.0} s", to - from));
    }
    let words = transcript::read(root, &video).map(|t| t.words).unwrap_or_default();
    let (from, to) = if opts.snap { snap(&words, from, to) } else { (from, to) };
    let (from, to) = ((from * 1000.0).round() / 1000.0, (to * 1000.0).round() / 1000.0);
    let duration = ((to - from) * 1000.0).round() / 1000.0;

    let rel_path = format!("assets/video/clips/{id}.mp4");
    let out = root.join(&rel_path);
    let timing_rel = format!("assets/audio/vo/{id}.timing.json");
    if out.exists() && !opts.force {
        return Err(format!("{rel_path} exists; pass force to cut it again, or pick another id"));
    }
    std::fs::create_dir_all(out.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(root.join("assets/audio/vo")).map_err(|e| e.to_string())?;

    let ffmpeg = crate::youtube::find("ffmpeg", Some(ENV_OVERRIDE))
        .ok_or("cutting clips needs ffmpeg (brew install ffmpeg); yt-dlp needs it too")?;
    let child = tokio::process::Command::new(&ffmpeg)
        .args(cut_args(&root.join(&video), from, duration, &out))
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let done = tokio::time::timeout(TIMEOUT, child)
        .await
        .map_err(|_| "ffmpeg took over 30 minutes and was stopped".to_string())?
        .map_err(|e| format!("couldn't run {}: {e}", ffmpeg.display()))?;
    if !done.status.success() || !out.is_file() {
        let _ = std::fs::remove_file(&out);
        return Err(format!("ffmpeg couldn't cut the clip: {}", String::from_utf8_lossy(&done.stderr).trim()));
    }

    let words = clip_words(&words, from, to);
    let text = words.iter().map(|w| w.word.as_str()).collect::<Vec<_>>().join(" ");
    let timing = json!({
        "lineId": id,
        "duration": duration,
        "words": words,
        "src": rel_path,
        "clip": { "video": rel_path, "from": 0, "to": duration, "source": { "video": video, "from": from, "to": to } },
    });
    std::fs::write(root.join(&timing_rel), serde_json::to_string_pretty(&timing).unwrap()).map_err(|e| e.to_string())?;
    Ok(Clipped {
        usage: usage(&id),
        id,
        rel_path,
        timing: timing_rel,
        from,
        to,
        duration,
        words: words.len(),
        text,
    })
}

pub fn tool_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "video": { "type": "string", "description": "The long project video, e.g. \"assets/video/podcast.mp4\"" },
            "from": { "type": "number", "description": "Start, seconds into the video (from video_transcript)" },
            "to": { "type": "number", "description": "End, seconds into the video" },
            "id": { "type": "string", "description": "Clip id, e.g. \"clip-01\": names the file and the VO line" },
            "snap": { "type": "boolean", "default": true, "description": "Move the ends to word edges so no word is cut off" },
            "force": { "type": "boolean", "default": false, "description": "Cut again when the clip exists" }
        },
        "required": ["video", "from", "to", "id"]
    })
}

pub const TOOL_DESCRIPTION: &str = "Cut a stretch of a long project video into a short clip: \
    assets/video/clips/<id>.mp4 (with its sound) plus VO line <id> holding its words in clip time. \
    Then scene(id, { vo: [id], pad: 0 }) runs exactly as long as the clip, clipVideo(root, id, { width, height }) \
    shows it full-frame, and captions(root, { lines: [id] }) puts karaoke captions on it. \
    Pick from/to with video_transcript; ends snap to word edges. Needs ffmpeg.";

#[cfg(test)]
mod tests {
    use super::*;

    fn w(word: &str, start: f64, end: f64) -> Word {
        Word { word: word.into(), start, end }
    }

    #[test]
    fn snaps_ends_to_whole_words() {
        let words = [w("So", 10.0, 10.3), w("here's", 10.4, 10.8), w("the", 10.9, 11.0), w("thing.", 11.1, 11.6)];
        let (a, b) = snap(&words, 10.6, 11.3);
        assert!((a - (10.4 - 0.12)).abs() < 1e-9, "{a}");
        assert!((b - (11.6 + 0.2)).abs() < 1e-9, "{b}");
        // between words: from the next word, to the end of the last one that started
        let (a, b) = snap(&words, 10.35, 10.85);
        assert!((a - 10.28).abs() < 1e-9 && (b - 11.0).abs() < 1e-9, "{a} {b}");
        assert_eq!(snap(&[], 3.0, 9.0), (3.0, 9.0));
    }

    #[test]
    fn moves_words_into_clip_time() {
        let words = [w("before", 1.0, 1.5), w("Hello", 10.2, 10.5), w("there.", 10.6, 11.0), w("after", 20.0, 20.5)];
        assert_eq!(clip_words(&words, 10.0, 11.2), vec![w("Hello", 0.2, 0.5), w("there.", 0.6, 1.0)]);
    }

    #[test]
    fn ids_and_ffmpeg_arguments() {
        assert_eq!(check_id(" clip-01 ").unwrap(), "clip-01");
        assert!(check_id("Clip 1").is_err());
        assert!(check_id("../x").is_err());
        assert!(check_id("--y").is_err());
        let a = cut_args(Path::new("/p/long.mp4"), 812.4, 38.6, Path::new("/p/c.mp4"));
        assert!(a.windows(2).any(|p| p == ["-ss", "812.400"]));
        assert!(a.windows(2).any(|p| p == ["-t", "38.600"]));
        assert!(a.windows(2).any(|p| p == ["-bf", "0"]));
        assert_eq!(a.last().unwrap(), "/p/c.mp4");
    }

    /// A stand-in ffmpeg that writes its last argument.
    #[cfg(unix)]
    #[allow(unused_unsafe)]
    #[tokio::test]
    async fn cuts_a_clip_with_its_words_as_a_vo_line() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("ffmpeg");
        std::fs::write(&fake, "#!/bin/sh\nfor a in \"$@\"; do last=\"$a\"; done\nprintf 'mp4' > \"$last\"\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let root = dir.path().join("p");
        std::fs::create_dir_all(root.join("assets/video")).unwrap();
        std::fs::write(root.join("assets/video/long.mp4"), b"x").unwrap();
        transcript::write(
            &root,
            &transcript::Transcript {
                video: "assets/video/long.mp4".into(),
                source: "s".into(),
                language: "en".into(),
                kind: "youtube".into(),
                words: vec![w("Hello", 100.0, 100.4), w("world.", 100.5, 101.0), w("Next", 105.0, 105.3)],
            },
        )
        .unwrap();
        // SAFETY: only this test reads the variable
        unsafe { std::env::set_var(ENV_OVERRIDE, &fake) };
        let opts = ClipOptions { snap: true, force: false };
        let c = make_clip(&root, "assets/video/long.mp4", 100.1, 100.9, "clip-01", &opts).await.unwrap();
        assert_eq!(c.rel_path, "assets/video/clips/clip-01.mp4");
        assert_eq!((c.from, c.to, c.duration), (99.88, 101.2, 1.32));
        assert_eq!(c.text, "Hello world.");
        let timing: Value = serde_json::from_str(&std::fs::read_to_string(root.join(&c.timing)).unwrap()).unwrap();
        assert_eq!(timing["lineId"], "clip-01");
        assert_eq!(timing["src"], "assets/video/clips/clip-01.mp4");
        assert_eq!(timing["words"][0], json!({ "word": "Hello", "start": 0.12, "end": 0.52 }));
        assert_eq!(timing["clip"]["source"]["from"], 99.88);
        assert!(make_clip(&root, "assets/video/long.mp4", 1.0, 2.0, "clip-01", &opts).await.unwrap_err().contains("exists"));
        assert!(make_clip(&root, "assets/video/long.mp4", 0.0, 900.0, "clip-02", &opts).await.unwrap_err().contains("at most"));
        unsafe { std::env::remove_var(ENV_OVERRIDE) };
    }
}
