//! Word-timed transcripts of long videos, for picking clips and for captions on them.
//!
//! A transcript sits next to its video as `<name>.transcript.json`:
//! `{ "video", "source", "language", "kind", "words": [{ "word", "start", "end" }] }`, seconds from
//! the start of the video. The words use the same shape as VO timings, so captions read either.
//!
//! Sources:
//! - YouTube captions (json3). Speech recognition captions (`<lang>-orig`) carry a time per word but
//!   no punctuation; uploaded captions carry punctuation but only a time per line. When both exist
//!   the uploaded text is kept and each word takes the recognised word's time ([`merge`]).
//! - ElevenLabs Scribe ([`scribe`]) for videos with no captions.
//!
//! This file is duplicated in `apps/cli/src/transcript.rs` and `apps/desktop/src-tauri/src/transcript.rs`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transcript {
    /// Project path of the video
    pub video: String,
    /// Where the words came from: a URL, or the video itself
    pub source: String,
    pub language: String,
    /// `youtube` (uploaded captions timed by recognition), `youtube-auto`, `youtube-lines` or `scribe`
    pub kind: String,
    pub words: Vec<Word>,
}

/// One caption line of uploaded captions: text over a time span, no word times.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// `assets/video/talk.mp4` -> `assets/video/talk.transcript.json`
pub fn transcript_path(video: &str) -> String {
    let stem = video.rsplit_once('.').map(|(s, _)| s).unwrap_or(video);
    format!("{stem}.transcript.json")
}

/// Words from YouTube speech recognition captions (json3 with `tOffsetMs` per word).
pub fn parse_json3_words(json: &Value) -> Vec<Word> {
    let mut events: Vec<(f64, f64, Vec<(f64, String)>)> = Vec::new();
    for e in json["events"].as_array().into_iter().flatten() {
        let Some(segs) = e["segs"].as_array() else { continue };
        let t0 = e["tStartMs"].as_f64().unwrap_or(0.0) / 1000.0;
        let t1 = t0 + e["dDurationMs"].as_f64().unwrap_or(0.0) / 1000.0;
        let words: Vec<(f64, String)> = segs
            .iter()
            .filter_map(|s| {
                let text = s["utf8"].as_str()?.trim();
                (!text.is_empty()).then(|| (t0 + s["tOffsetMs"].as_f64().unwrap_or(0.0) / 1000.0, text.to_string()))
            })
            .collect();
        if !words.is_empty() {
            events.push((t0, t1, words));
        }
    }
    let mut out = Vec::new();
    for (i, (_, t1, words)) in events.iter().enumerate() {
        // rolling captions stay on screen past the next line, so a line's last word ends where the next starts
        let next = events.get(i + 1).map(|e| e.2[0].0).unwrap_or(*t1);
        for (j, (start, text)) in words.iter().enumerate() {
            let end = words.get(j + 1).map(|w| w.0).unwrap_or_else(|| t1.min(next));
            out.push(Word { word: text.clone(), start: *start, end: end.max(*start) });
        }
    }
    out
}

/// Lines of uploaded captions (json3 without word times).
pub fn parse_json3_lines(json: &Value) -> Vec<Line> {
    json["events"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let text: String = e["segs"].as_array()?.iter().filter_map(|s| s["utf8"].as_str()).collect();
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            let start = e["tStartMs"].as_f64()? / 1000.0;
            let end = start + e["dDurationMs"].as_f64().unwrap_or(0.0) / 1000.0;
            (!text.is_empty()).then_some(Line { start, end, text })
        })
        .collect()
}

fn norm(w: &str) -> String {
    w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Uploaded caption text with recognised word times: each line's words are matched to the
/// recognised words around it (longest common subsequence); a word with no match is placed
/// between its matched neighbours. With no recognised words the line's span is shared out by length.
pub fn merge(lines: &[Line], auto: &[Word]) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    let mut cursor = 0usize;
    for line in lines {
        let words: Vec<&str> = line.text.split_whitespace().collect();
        let lo = auto[cursor..].iter().position(|w| w.start >= line.start - 1.5).map_or(auto.len(), |p| cursor + p);
        let hi = auto[lo..].iter().position(|w| w.start > line.end + 1.5).map_or(auto.len(), |p| lo + p);
        let cand = &auto[lo..hi];
        let a: Vec<String> = words.iter().map(|w| norm(w)).collect();
        let b: Vec<String> = cand.iter().map(|w| norm(&w.word)).collect();
        // LCS table
        let (n, m) = (a.len(), b.len());
        let mut dp = vec![0u16; (n + 1) * (m + 1)];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                dp[i * (m + 1) + j] = if !a[i].is_empty() && a[i] == b[j] {
                    dp[(i + 1) * (m + 1) + j + 1] + 1
                } else {
                    dp[(i + 1) * (m + 1) + j].max(dp[i * (m + 1) + j + 1])
                };
            }
        }
        let mut matched: Vec<Option<&Word>> = vec![None; n];
        let (mut i, mut j) = (0, 0);
        let mut last = None;
        while i < n && j < m {
            if !a[i].is_empty() && a[i] == b[j] {
                matched[i] = Some(&cand[j]);
                last = Some(lo + j);
                i += 1;
                j += 1;
            } else if dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1] {
                i += 1;
            } else {
                j += 1;
            }
        }
        if let Some(l) = last {
            cursor = l + 1;
        }
        // fill the gaps between matched words, by character count
        let mut k = 0;
        while k < n {
            if let Some(w) = matched[k] {
                out.push(Word { word: words[k].to_string(), start: w.start, end: w.end });
                k += 1;
                continue;
            }
            let run_end = (k..n).find(|&x| matched[x].is_some()).unwrap_or(n);
            let from = out.last().filter(|_| k > 0).map(|w| w.end).unwrap_or(line.start);
            let to = matched.get(run_end).copied().flatten().map(|w| w.start).unwrap_or(line.end).max(from);
            let chars: usize = words[k..run_end].iter().map(|w| w.len() + 1).sum();
            let mut t = from;
            for w in &words[k..run_end] {
                let d = (to - from) * (w.len() + 1) as f64 / chars as f64;
                out.push(Word { word: w.to_string(), start: t, end: t + d });
                t += d;
            }
            k = run_end;
        }
    }
    // never step back in time
    for x in 1..out.len() {
        if out[x].start < out[x - 1].start {
            out[x].start = out[x - 1].start;
        }
        if out[x].end < out[x].start {
            out[x].end = out[x].start;
        }
    }
    out
}

/// Words from an ElevenLabs Scribe response (`words` of type `word`).
pub fn parse_scribe(json: &Value) -> Vec<Word> {
    json["words"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|w| w["type"].as_str().unwrap_or("word") == "word")
        .filter_map(|w| {
            let word = w["text"].as_str()?.trim();
            (!word.is_empty()).then(|| Word {
                word: word.to_string(),
                start: w["start"].as_f64().unwrap_or(0.0),
                end: w["end"].as_f64().unwrap_or(0.0),
            })
        })
        .collect()
}

/// A stretch of speech: a sentence, or a run of words broken at a pause.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Sentence {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Splits at sentence punctuation, at pauses of 0.8 s or more, and after 30 words.
pub fn sentences(words: &[Word]) -> Vec<Sentence> {
    let mut out = Vec::new();
    let mut cur: Vec<&Word> = Vec::new();
    for (i, w) in words.iter().enumerate() {
        cur.push(w);
        let ends = w.word.ends_with(['.', '?', '!', '…']);
        let pause = words.get(i + 1).is_some_and(|n| n.start - w.end >= 0.8);
        if ends || pause || cur.len() >= 30 || i + 1 == words.len() {
            out.push(Sentence {
                start: cur[0].start,
                end: w.end,
                text: cur.iter().map(|w| w.word.as_str()).collect::<Vec<_>>().join(" "),
            });
            cur.clear();
        }
    }
    out
}

/// `754.3` -> `12:34.3`; past an hour `1:02:03.0`.
pub fn clock(t: f64) -> String {
    let t = t.max(0.0);
    let tenths = (t * 10.0).round() as u64;
    let (h, m, s, d) = (tenths / 36000, tenths / 600 % 60, tenths / 10 % 60, tenths % 10);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}.{d}")
    } else {
        format!("{m:02}:{s:02}.{d}")
    }
}

pub fn read(root: &Path, video: &str) -> Result<Transcript, String> {
    let path = root.join(transcript_path(video));
    let body = std::fs::read_to_string(&path).map_err(|_| {
        format!(
            "{} has no transcript yet ({}). Download it with youtube_download, or make one with video_transcribe",
            video,
            transcript_path(video)
        )
    })?;
    serde_json::from_str(&body).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn write(root: &Path, t: &Transcript) -> Result<String, String> {
    let rel = transcript_path(&t.video);
    let path = root.join(&rel);
    let ms = |x: f64| (x * 1000.0).round() / 1000.0;
    let mut t = t.clone();
    for w in &mut t.words {
        (w.start, w.end) = (ms(w.start), ms(w.end));
    }
    let body = serde_json::to_string(&t).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
    Ok(rel)
}

pub const SCRIBE_URL: &str = "https://api.elevenlabs.io/v1/speech-to-text";

pub const NO_KEY: &str = "transcribing needs an ElevenLabs key (ELEVENLABS_API_KEY, the same key as the voice-over)";

/// Transcribes `audio` (cut from project video `video`) with ElevenLabs Scribe.
pub async fn scribe(key: &str, video: &str, audio: &Path, language: Option<&str>) -> Result<Transcript, String> {
    let bytes = tokio::fs::read(audio).await.map_err(|e| format!("couldn't read {}: {e}", audio.display()))?;
    let name = audio.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "audio.m4a".into());
    let mut form = reqwest::multipart::Form::new()
        .text("model_id", "scribe_v1")
        .text("timestamps_granularity", "word")
        .part("file", reqwest::multipart::Part::bytes(bytes).file_name(name));
    if let Some(lang) = language.filter(|l| !l.is_empty()) {
        form = form.text("language_code", lang.to_string());
    }
    let resp = reqwest::Client::new()
        .post(SCRIBE_URL)
        .header("xi-api-key", key)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60 * 30))
        .send()
        .await
        .map_err(|e| format!("ElevenLabs speech-to-text: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("ElevenLabs speech-to-text: {e}"))?;
    if !status.is_success() {
        return Err(format!("ElevenLabs speech-to-text failed ({status}): {}", body["detail"]));
    }
    let words = parse_scribe(&body);
    if words.is_empty() {
        return Err("ElevenLabs heard no speech in this video".into());
    }
    Ok(Transcript {
        video: video.to_string(),
        source: video.to_string(),
        language: body["language_code"].as_str().unwrap_or(language.unwrap_or("")).to_string(),
        kind: "scribe".into(),
        words,
    })
}

/// The audio track of a project video as `.m4a` (ffmpeg, no re-encode), or the video itself when
/// ffmpeg is missing (Scribe takes video files too, but uploads are larger).
pub async fn audio_for(root: &Path, video: &str, scratch: &Path) -> PathBuf {
    let src = root.join(video);
    let out = scratch.join("audio.m4a");
    let ok = tokio::process::Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-i"])
        .arg(&src)
        .args(["-vn", "-c:a", "copy"])
        .arg(&out)
        .stdin(std::process::Stdio::null())
        .status()
        .await
        .is_ok_and(|s| s.success());
    if ok { out } else { src }
}

/// Makes `<name>.transcript.json` for a project video with Scribe (kept when it exists, unless `force`).
pub async fn transcribe(root: &Path, video: &str, key: &str, language: Option<&str>, force: bool) -> Result<(String, Transcript), String> {
    let video = video.trim().trim_start_matches("./");
    if video.starts_with('-') || video.starts_with('/') || video.contains("..") || !root.join(video).is_file() {
        return Err(format!("video not found: {video}"));
    }
    if !force {
        if let Ok(t) = read(root, video) {
            return Ok((transcript_path(video), t));
        }
    }
    let scratch = std::env::temp_dir().join(format!("liosvideo-stt-{}-{}", std::process::id(), video.len()));
    std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
    let audio = audio_for(root, video, &scratch).await;
    let result = scribe(key, video, &audio, language).await;
    let _ = std::fs::remove_dir_all(&scratch);
    let t = result?;
    Ok((write(root, &t)?, t))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn w(word: &str, start: f64, end: f64) -> Word {
        Word { word: word.into(), start, end }
    }

    #[test]
    fn reads_word_times_from_speech_recognition_captions() {
        let j = json!({ "events": [
            { "tStartMs": 0, "dDurationMs": 9000, "id": 1 },
            { "tStartMs": 960, "dDurationMs": 3760, "segs": [
                { "utf8": "station" }, { "utf8": " this", "tOffsetMs": 480 }, { "utf8": " is", "tOffsetMs": 640 } ] },
            { "tStartMs": 2950, "dDurationMs": 1770, "aAppend": 1, "segs": [{ "utf8": "\n" }] },
            { "tStartMs": 2960, "dDurationMs": 5360, "segs": [{ "utf8": "for" }, { "utf8": " the", "tOffsetMs": 160 }] }
        ]});
        let words = parse_json3_words(&j);
        assert_eq!(
            words,
            vec![w("station", 0.96, 1.44), w("this", 1.44, 1.6), w("is", 1.6, 2.96), w("for", 2.96, 3.12), w("the", 3.12, 8.32)]
        );
    }

    #[test]
    fn keeps_uploaded_caption_text_with_recognised_word_times() {
        let lines = vec![
            Line { start: 0.4, end: 4.0, text: "Station, this is Houston. Are you ready?".into() },
            Line { start: 4.9, end: 7.0, text: "I'm ready!".into() },
        ];
        let auto = vec![
            w("station", 0.96, 1.44), w("this", 1.44, 1.6), w("is", 1.6, 1.8), w("houston", 1.8, 2.3),
            w("are", 2.3, 2.5), w("ready", 2.9, 3.4), w("im", 5.0, 5.3), w("ready", 5.3, 5.9),
        ];
        let m = merge(&lines, &auto);
        let texts: Vec<&str> = m.iter().map(|w| w.word.as_str()).collect();
        assert_eq!(texts, ["Station,", "this", "is", "Houston.", "Are", "you", "ready?", "I'm", "ready!"]);
        assert_eq!((m[0].start, m[3].start), (0.96, 1.8));
        // "you" was not recognised: it sits between "Are" and "ready?"
        assert!(m[5].start >= 2.5 && m[5].end <= 2.9, "{:?}", m[5]);
        assert_eq!(m[7].start, 5.0);
        assert!(m.windows(2).all(|p| p[1].start >= p[0].start));
    }

    #[test]
    fn spreads_a_line_over_its_span_without_recognised_words() {
        let m = merge(&[Line { start: 10.0, end: 12.0, text: "ab cd".into() }], &[]);
        assert_eq!(m, vec![w("ab", 10.0, 11.0), w("cd", 11.0, 12.0)]);
    }

    #[test]
    fn reads_scribe_words_and_skips_spacing_and_sounds() {
        let j = json!({ "language_code": "eng", "words": [
            { "text": "Hello", "start": 0.1, "end": 0.4, "type": "word" },
            { "text": " ", "start": 0.4, "end": 0.5, "type": "spacing" },
            { "text": "(laughs)", "start": 0.5, "end": 1.0, "type": "audio_event" },
            { "text": "there.", "start": 1.0, "end": 1.3, "type": "word" } ]});
        assert_eq!(parse_scribe(&j), vec![w("Hello", 0.1, 0.4), w("there.", 1.0, 1.3)]);
    }

    #[test]
    fn splits_sentences_and_formats_clock_times() {
        let t = Transcript {
            video: "assets/video/a.mp4".into(),
            source: "x".into(),
            language: "en".into(),
            kind: "youtube".into(),
            words: vec![w("Hi.", 0.0, 0.5), w("so", 0.6, 0.8), w("then", 0.8, 1.0), w("we", 2.0, 2.2), w("won!", 2.3, 2.6)],
        };
        let s: Vec<(f64, String)> = sentences(&t.words).into_iter().map(|s| (s.start, s.text)).collect();
        assert_eq!(s, [(0.0, "Hi.".to_string()), (0.6, "so then".to_string()), (2.0, "we won!".to_string())]);
        assert_eq!(clock(3725.36), "1:02:05.4");
        assert_eq!(transcript_path("assets/video/talk.mp4"), "assets/video/talk.transcript.json");
    }
}
