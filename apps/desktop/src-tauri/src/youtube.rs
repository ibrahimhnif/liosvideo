//! Long videos from YouTube (and the other sites yt-dlp reads) into the project, with a word-timed
//! transcript, as the source for short clips.
//!
//! yt-dlp is a separate tool and is not bundled: `brew install yt-dlp` or `uv tool install yt-dlp`.
//! YouTube also needs a JavaScript runtime for yt-dlp (deno, or node, which is passed along).
//! The video lands in `assets/video/<name>.mp4` as H.264 (what the renderer decodes), its captions
//! become `<name>.transcript.json` ([`crate::transcript`]), and its row goes into
//! `assets/ATTRIBUTIONS.md`. Clip only videos you may clip: your own, ones whose owner allows it (a
//! clipping campaign), or Creative Commons.
//!
//! This file is duplicated in `apps/cli/src/youtube.rs` and `apps/desktop/src-tauri/src/youtube.rs`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::transcript::{self, Transcript};

pub const INSTALL: &str = "brew install yt-dlp (or: uv tool install yt-dlp), plus deno or node for YouTube";
const ENV_OVERRIDE: &str = "LIOSVIDEO_YTDLP";
const TIMEOUT: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Default, PartialEq)]
pub struct DownloadOptions {
    /// File name without extension (default: from the title)
    pub name: Option<String>,
    /// Caption language (default: the video's own)
    pub lang: Option<String>,
    /// Tallest picture to fetch (default 1080)
    pub max_height: Option<u32>,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    pub rel_path: String,
    pub title: String,
    pub channel: String,
    pub url: String,
    pub duration: f64,
    /// The transcript file, when the video had captions
    pub transcript: Option<String>,
    pub transcript_kind: Option<String>,
    pub words: usize,
    pub attribution_file: String,
    /// false when the file was already there and kept
    pub made: bool,
    pub next: String,
}

pub fn find(name: &str, env: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = env.and_then(std::env::var_os).map(PathBuf::from) {
        return path.is_file().then_some(path);
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".deno/bin"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    dirs.into_iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

/// The `yt-dlp` command: `$LIOSVIDEO_YTDLP`, then PATH and the usual install folders.
pub fn binary() -> Option<PathBuf> {
    find("yt-dlp", Some(ENV_OVERRIDE))
}

fn not_installed() -> String {
    format!("yt-dlp is not installed. Install it with: {INSTALL}. Or set {ENV_OVERRIDE} to the yt-dlp command.")
}

/// A web address, never a flag or a local path.
pub fn check_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let ok = (url.starts_with("https://") || url.starts_with("http://")) && !url.chars().any(char::is_whitespace);
    if ok { Ok(url.to_string()) } else { Err(format!("not a video URL: \"{url}\"")) }
}

/// "Why We Sleep — Ep. 12!" -> "why-we-sleep-ep-12"; a given name is cleaned the same way.
pub fn file_stem(title: &str, name: Option<&str>) -> String {
    let raw = name.map(str::trim).filter(|n| !n.is_empty()).unwrap_or(title);
    let raw = raw.strip_suffix(".mp4").unwrap_or(raw);
    let mut out = String::new();
    for c in raw.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(60).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "video".into() } else { out }
}

/// yt-dlp's format choice: H.264 video with AAC sound up to `h` pixels tall, else the best there is
/// (converted afterwards).
pub fn format_selector(h: u32) -> String {
    format!("bv*[vcodec^=avc1][height<={h}]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<={h}]/bv*[height<={h}]+ba/b")
}

/// `--js-runtimes node:<path>` when deno (yt-dlp's default) is missing and node is there.
fn js_runtime_args() -> Vec<String> {
    if find("deno", None).is_some() {
        return vec![];
    }
    match find("node", None) {
        Some(node) => vec!["--js-runtimes".into(), format!("node:{}", node.display())],
        None => vec![],
    }
}

pub fn download_args(url: &str, out_stem: &Path, lang: &str, max_height: u32) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--no-progress".into(),
        "--force-overwrites".into(),
        "-f".into(),
        format_selector(max_height),
        "--merge-output-format".into(),
        "mp4".into(),
        "-o".into(),
        format!("{}.%(ext)s", out_stem.display()),
        "--write-subs".into(),
        "--write-auto-subs".into(),
        "--sub-langs".into(),
        format!("{lang}-orig,{lang}"),
        "--sub-format".into(),
        "json3".into(),
        "--no-simulate".into(),
        "--print".into(),
        "after_move:%(vcodec)s".into(),
    ];
    args.extend(js_runtime_args());
    args.push(url.into());
    args
}

async fn run(bin: &Path, args: &[String]) -> Result<String, String> {
    let child = tokio::process::Command::new(bin)
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(TIMEOUT, child)
        .await
        .map_err(|_| "yt-dlp took over an hour and was stopped".to_string())?
        .map_err(|e| format!("couldn't run {}: {e}", bin.display()))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = stderr.lines().rev().find(|l| l.contains("ERROR")).or_else(|| stderr.lines().last()).unwrap_or("");
        Err(format!("yt-dlp failed: {}", detail.trim()))
    }
}

/// The video's details (`yt-dlp --dump-single-json`), without downloading it.
pub async fn probe(url: &str) -> Result<Value, String> {
    let url = check_url(url)?;
    let bin = binary().ok_or_else(not_installed)?;
    let mut args: Vec<String> = vec!["--dump-single-json".into(), "--no-playlist".into(), "--no-warnings".into()];
    args.extend(js_runtime_args());
    args.push(url);
    let out = run(&bin, &args).await?;
    serde_json::from_str(&out).map_err(|e| format!("unexpected output from yt-dlp: {e}"))
}

/// H.264 + AAC with ffmpeg, for a video that only came in another codec.
async fn to_h264(path: &Path) -> Result<(), String> {
    let tmp = path.with_extension("h264.mp4");
    let ok = tokio::process::Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-i"])
        .arg(path)
        .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"])
        .arg(&tmp)
        .stdin(std::process::Stdio::null())
        .status()
        .await
        .map_err(|_| "this video only comes in a codec the renderer can't read; install ffmpeg to convert it to H.264".to_string())?
        .success();
    if !ok {
        let _ = std::fs::remove_file(&tmp);
        return Err("ffmpeg couldn't convert the video to H.264".into());
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The transcript from the caption files yt-dlp wrote next to `stem` (then removed).
pub fn transcript_from_captions(dir: &Path, stem: &str, lang: &str, video: &str, url: &str, has_uploaded: bool) -> Option<Transcript> {
    let read = |suffix: &str| -> Option<Value> {
        let path = dir.join(format!("{stem}.{suffix}.json3"));
        let body = std::fs::read_to_string(&path).ok();
        let _ = std::fs::remove_file(&path);
        serde_json::from_str(&body?).ok()
    };
    let orig = read(&format!("{lang}-orig"));
    let plain = read(lang);
    let auto = orig.as_ref().map(transcript::parse_json3_words).unwrap_or_default();
    let lines = plain.as_ref().filter(|_| has_uploaded).map(transcript::parse_json3_lines).unwrap_or_default();
    let (words, kind) = match (lines.is_empty(), auto.is_empty()) {
        (false, false) => (transcript::merge(&lines, &auto), "youtube"),
        (false, true) => (transcript::merge(&lines, &[]), "youtube-lines"),
        (true, false) => (auto, "youtube-auto"),
        // no -orig track: the plain one is recognition captions with word times
        (true, true) => (plain.as_ref().map(transcript::parse_json3_words).unwrap_or_default(), "youtube-auto"),
    };
    (!words.is_empty()).then(|| Transcript {
        video: video.to_string(),
        source: url.to_string(),
        language: lang.to_string(),
        kind: kind.to_string(),
        words,
    })
}

/// Downloads `url` into `assets/video/<name>.mp4` with its transcript and attribution row.
pub async fn download(root: &Path, url: &str, opts: &DownloadOptions) -> Result<Downloaded, String> {
    let url = check_url(url)?;
    let bin = binary().ok_or_else(not_installed)?;
    let info = probe(&url).await?;
    let title = info["title"].as_str().unwrap_or("video").to_string();
    let channel = info["channel"].as_str().or(info["uploader"].as_str()).unwrap_or("").to_string();
    let page = info["webpage_url"].as_str().unwrap_or(&url).to_string();
    let duration = info["duration"].as_f64().unwrap_or(0.0);
    let lang = opts
        .lang
        .clone()
        .or_else(|| info["language"].as_str().map(String::from))
        .unwrap_or_else(|| "en".into());
    if !lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("not a language code: \"{lang}\""));
    }
    let has_uploaded = info["subtitles"].get(&lang).is_some();

    let stem = file_stem(&title, opts.name.as_deref());
    let dir = root.join("assets").join("video");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let rel_path = format!("assets/video/{stem}.mp4");
    let path = root.join(&rel_path);
    let made = opts.force || !path.exists();
    if made {
        let printed = run(&bin, &download_args(&page, &dir.join(&stem), &lang, opts.max_height.unwrap_or(1080))).await?;
        if !path.exists() {
            return Err(format!("yt-dlp finished but wrote no {rel_path}"));
        }
        let vcodec = printed.lines().last().unwrap_or("");
        if !vcodec.starts_with("avc1") && !vcodec.starts_with("h264") {
            to_h264(&path).await?;
        }
        if let Some(t) = transcript_from_captions(&dir, &stem, &lang, &rel_path, &page, has_uploaded) {
            transcript::write(root, &t)?;
        }
    }
    let t = transcript::read(root, &rel_path).ok();
    let licence = info["license"].as_str().filter(|l| !l.is_empty()).unwrap_or("YouTube Standard License");
    let attribution_file = crate::commons::record_row(
        root,
        &rel_path,
        &page,
        &channel,
        licence,
        &format!("\"{title}\"; clipped with the owner's permission"),
    )?;
    let next = match &t {
        Some(_) => format!("Read it with video_transcript (video: \"{rel_path}\") to pick clips."),
        None => format!(
            "It has no captions in \"{lang}\": make a transcript with video_transcribe (video: \"{rel_path}\"), \
             or try another lang."
        ),
    };
    Ok(Downloaded {
        rel_path: rel_path.clone(),
        title,
        channel,
        url: page,
        duration,
        transcript: t.as_ref().map(|_| transcript::transcript_path(&rel_path)),
        transcript_kind: t.as_ref().map(|t| t.kind.clone()),
        words: t.as_ref().map_or(0, |t| t.words.len()),
        attribution_file,
        made,
        next,
    })
}

// ---- MCP tools (the same in the CLI and the desktop app) ----

pub const TOOL_NAMES: [&str; 4] = ["youtube_download", "video_transcript", "video_transcribe", "video_clip"];

pub fn tool_description(name: &str) -> &'static str {
    match name {
        "video_clip" => crate::clips::TOOL_DESCRIPTION,
        "youtube_download" => {
            "Download a long video from YouTube (or another site yt-dlp reads) into assets/video/<name>.mp4 \
             as H.264, with a word-timed transcript from its captions (<name>.transcript.json) and its \
             assets/ATTRIBUTIONS.md row, as the source for short clips. Only for videos you may clip: your \
             own, a clipping campaign's, or Creative Commons. Needs yt-dlp (the error says how to install it). \
             Then read the transcript with video_transcript to pick clips."
        }
        "video_transcript" => {
            "Read a project video's transcript as lines of [mm:ss.s → mm:ss.s] text, to pick clips: \
             strong hooks, whole thoughts, 20-60 s. Pass from/to (seconds) for a stretch; long transcripts \
             come in parts (call again with nextFrom). words: true adds each word's time, for exact cuts."
        }
        _ => {
            "Make a word-timed transcript for a project video that has none (e.g. a downloaded video \
             without captions, or a file the user added) with ElevenLabs speech-to-text (the voice-over \
             key). Writes <name>.transcript.json next to the video."
        }
    }
}

pub fn tool_schema(name: &str) -> Value {
    match name {
        "video_clip" => crate::clips::tool_schema(),
        "youtube_download" => serde_json::json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "Video page URL, e.g. https://www.youtube.com/watch?v=…" },
                "name": { "type": "string", "description": "File name without extension (default: from the title)" },
                "lang": { "type": "string", "description": "Caption language code (default: the video's own), e.g. en, id" },
                "maxHeight": { "type": "integer", "default": 1080, "description": "Tallest picture to fetch" },
                "force": { "type": "boolean", "default": false, "description": "Download again when the file exists" }
            },
            "required": ["url"]
        }),
        "video_transcript" => serde_json::json!({
            "type": "object",
            "properties": {
                "video": { "type": "string", "description": "Project video, e.g. \"assets/video/talk.mp4\"" },
                "from": { "type": "number", "description": "Start of the stretch, seconds" },
                "to": { "type": "number", "description": "End of the stretch, seconds" },
                "words": { "type": "boolean", "default": false, "description": "Also list each word with its time" }
            },
            "required": ["video"]
        }),
        _ => serde_json::json!({
            "type": "object",
            "properties": {
                "video": { "type": "string", "description": "Project video, e.g. \"assets/video/talk.mp4\"" },
                "lang": { "type": "string", "description": "Spoken language code, e.g. en, id (default: detected)" },
                "force": { "type": "boolean", "default": false, "description": "Transcribe again when a transcript exists" }
            },
            "required": ["video"]
        }),
    }
}

/// Characters of transcript per `video_transcript` answer; longer ones continue from `nextFrom`.
const PART: usize = 40_000;

/// The `video_transcript` answer for `t` between `from` and `to`.
pub fn transcript_answer(t: &Transcript, from: Option<f64>, to: Option<f64>, words: bool) -> Value {
    let (lo, hi) = (from.unwrap_or(0.0), to.unwrap_or(f64::INFINITY));
    let mut text = String::new();
    let mut next_from = None;
    for s in transcript::sentences(&t.words).into_iter().filter(|s| s.end > lo && s.start < hi) {
        if text.len() > PART {
            next_from = Some((s.start * 10.0).floor() / 10.0);
            break;
        }
        text.push_str(&format!("[{} → {}] {}\n", transcript::clock(s.start), transcript::clock(s.end), s.text));
    }
    let end = next_from.unwrap_or(hi);
    let mut out = serde_json::json!({
        "video": t.video,
        "language": t.language,
        "kind": t.kind,
        "duration": t.words.last().map_or(0.0, |w| w.end),
        "text": text.trim_end(),
    });
    if let Some(n) = next_from {
        out["nextFrom"] = n.into();
    }
    if words {
        out["words"] = t.words.iter().filter(|w| w.end > lo && w.start < end).cloned().map(|w| serde_json::json!(w)).collect();
    }
    out
}

/// Runs one of [`TOOL_NAMES`] for the project at `root`.
pub async fn call_tool(name: &str, root: &Path, args: Value, elevenlabs_key: Option<String>) -> Result<Value, String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(String::from);
    let video = || s("video").ok_or_else(|| "video is required".to_string());
    let force = args.get("force").and_then(Value::as_bool).unwrap_or(false);
    match name {
        "youtube_download" => {
            let url = s("url").ok_or("url is required")?;
            let opts = DownloadOptions {
                name: s("name"),
                lang: s("lang"),
                max_height: args.get("maxHeight").and_then(Value::as_u64).map(|h| h.clamp(144, 2160) as u32),
                force,
            };
            serde_json::to_value(download(root, &url, &opts).await?).map_err(|e| e.to_string())
        }
        "video_transcript" => {
            let t = transcript::read(root, &video()?)?;
            let n = |k: &str| args.get(k).and_then(Value::as_f64);
            Ok(transcript_answer(&t, n("from"), n("to"), args.get("words").and_then(Value::as_bool).unwrap_or(false)))
        }
        "video_clip" => {
            let n = |k: &str| args.get(k).and_then(Value::as_f64).ok_or_else(|| format!("{k} (seconds) is required"));
            let opts = crate::clips::ClipOptions { snap: args.get("snap").and_then(Value::as_bool).unwrap_or(true), force };
            let id = s("id").ok_or("id is required")?;
            let c = crate::clips::make_clip(root, &video()?, n("from")?, n("to")?, &id, &opts).await?;
            serde_json::to_value(c).map_err(|e| e.to_string())
        }
        "video_transcribe" => {
            let key = elevenlabs_key.ok_or(transcript::NO_KEY)?;
            let (rel, t) = transcript::transcribe(root, &video()?, &key, s("lang").as_deref(), force).await?;
            Ok(serde_json::json!({ "transcript": rel, "kind": t.kind, "language": t.language, "words": t.words.len(),
                "next": format!("Read it with video_transcript (video: \"{}\")", t.video) }))
        }
        other => Err(format!("unknown tool {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_names_and_formats() {
        assert!(check_url("https://youtu.be/abc").is_ok());
        assert!(check_url("--exec rm").is_err());
        assert!(check_url("/etc/passwd").is_err());
        assert!(check_url("https://a b").is_err());
        assert_eq!(file_stem("Why We Sleep — Ep. 12!", None), "why-we-sleep-ep-12");
        assert_eq!(file_stem("x", Some("Podcast 3.mp4")), "podcast-3");
        assert_eq!(file_stem("!!!", None), "video");
        assert!(format_selector(720).starts_with("bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]"));
        let args = download_args("https://youtu.be/abc", Path::new("/p/assets/video/talk"), "id", 1080);
        assert!(args.windows(2).any(|w| w == ["--sub-langs", "id-orig,id"]));
        assert!(args.windows(2).any(|w| w == ["-o", "/p/assets/video/talk.%(ext)s"]));
        assert_eq!(args.last().unwrap(), "https://youtu.be/abc");
    }

    #[test]
    fn builds_the_transcript_from_both_caption_tracks_and_removes_them() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("talk.en-orig.json3"),
            r#"{"events":[{"tStartMs":1000,"dDurationMs":2000,"segs":[{"utf8":"hello"},{"utf8":" world","tOffsetMs":500}]}]}"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("talk.en.json3"),
            r#"{"events":[{"tStartMs":900,"dDurationMs":2200,"segs":[{"utf8":"Hello, world!"}]}]}"#,
        )
        .unwrap();
        let t = transcript_from_captions(dir.path(), "talk", "en", "assets/video/talk.mp4", "https://y", true).unwrap();
        assert_eq!(t.kind, "youtube");
        assert_eq!(t.words.iter().map(|w| w.word.as_str()).collect::<Vec<_>>(), ["Hello,", "world!"]);
        assert_eq!((t.words[0].start, t.words[1].start), (1.0, 1.5));
        assert!(!dir.path().join("talk.en.json3").exists() && !dir.path().join("talk.en-orig.json3").exists());
        assert!(transcript_from_captions(dir.path(), "talk", "en", "v", "u", true).is_none());
    }

    #[test]
    fn answers_transcripts_in_parts() {
        let words: Vec<transcript::Word> = (0..4000)
            .map(|i| transcript::Word { word: format!("word{i}."), start: i as f64, end: i as f64 + 0.5 })
            .collect();
        let t = Transcript { video: "v.mp4".into(), source: "s".into(), language: "en".into(), kind: "scribe".into(), words };
        let first = transcript_answer(&t, None, None, false);
        let next = first["nextFrom"].as_f64().unwrap();
        assert!(first["text"].as_str().unwrap().len() <= 40_100 && next > 100.0);
        let second = transcript_answer(&t, Some(next), None, true);
        assert!(second["text"].as_str().unwrap().starts_with(&format!("[{}", transcript::clock(next))));
        let near = transcript_answer(&t, Some(10.0), Some(12.0), true);
        assert_eq!(near["text"], "[00:10.0 → 00:10.5] word10.\n[00:11.0 → 00:11.5] word11.");
        assert_eq!(near["words"].as_array().unwrap().len(), 2);
        assert!(near.get("nextFrom").is_none());
    }

    /// A stand-in yt-dlp: prints details for --dump-single-json, else writes the files `-o` names.
    #[cfg(unix)]
    #[allow(unused_unsafe)]
    #[tokio::test]
    async fn downloads_with_transcript_and_attribution() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("yt-dlp");
        std::fs::write(
            &fake,
            "#!/bin/sh\n\
             case \"$*\" in *--dump-single-json*) echo '{\"title\":\"My Talk!\",\"channel\":\"Ann\",\"webpage_url\":\"https://youtu.be/x\",\"duration\":60,\"language\":\"en\",\"subtitles\":{}}'; exit 0;; esac\n\
             prev=\"\"; for a in \"$@\"; do [ \"$prev\" = \"-o\" ] && out=\"$a\"; prev=\"$a\"; done\n\
             stem=\"${out%.%(ext)s}\"\n\
             printf 'mp4' > \"$stem.mp4\"\n\
             echo '{\"events\":[{\"tStartMs\":0,\"dDurationMs\":1000,\"segs\":[{\"utf8\":\"hi\"}]}]}' > \"$stem.en-orig.json3\"\n\
             echo avc1.640028\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        // SAFETY: only this test reads the variable
        unsafe { std::env::set_var(ENV_OVERRIDE, &fake) };
        let d = download(&project, "https://youtu.be/x", &DownloadOptions::default()).await.unwrap();
        assert_eq!(d.rel_path, "assets/video/my-talk.mp4");
        assert_eq!(d.transcript.as_deref(), Some("assets/video/my-talk.transcript.json"));
        assert_eq!((d.transcript_kind.as_deref(), d.words, d.made), (Some("youtube-auto"), 1, true));
        let rows = std::fs::read_to_string(project.join("assets/ATTRIBUTIONS.md")).unwrap();
        assert!(rows.contains("| `assets/video/my-talk.mp4` | https://youtu.be/x | Ann | YouTube Standard License |"));
        let again = download(&project, "https://youtu.be/x", &DownloadOptions::default()).await.unwrap();
        assert!(!again.made);
        unsafe { std::env::set_var(ENV_OVERRIDE, dir.path().join("missing")) };
        assert!(download(&project, "https://youtu.be/x", &DownloadOptions::default()).await.unwrap_err().contains("brew install yt-dlp"));
        unsafe { std::env::remove_var(ENV_OVERRIDE) };
    }
}
