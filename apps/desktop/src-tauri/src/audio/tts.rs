use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WordTiming {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LineTiming {
    pub line_id: String,
    pub duration: f64,
    pub words: Vec<WordTiming>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
    pub gender: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtsResult {
    pub line_id: String,
    pub audio_rel_path: String,
    pub timing_rel_path: String,
    pub duration: f64,
    pub words: Vec<WordTiming>,
}

pub trait TtsProvider: Send + Sync {
    fn generate(
        &self,
        line_id: &str,
        text: &str,
        voice: Option<&str>,
        project_root: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<TtsResult, String>> + Send>>;

    fn list_voices(&self) -> Vec<VoiceInfo>;
}

#[derive(Default, Clone)]
pub struct MockTtsProvider;

impl MockTtsProvider {
    pub fn new() -> Self {
        Self
    }
}

// A minimal valid MP3 frame payload (silent MPEG-1 Layer 3, 128kbps, 44100Hz)
const SILENT_MP3_FRAME: &[u8] = &[
    0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

impl TtsProvider for MockTtsProvider {
    fn generate(
        &self,
        line_id: &str,
        text: &str,
        _voice: Option<&str>,
        project_root: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<TtsResult, String>> + Send>> {
        let line_id = line_id.to_string();
        let text = text.to_string();
        let project_root = project_root.to_path_buf();

        Box::pin(async move {
            let vo_dir = project_root.join("assets").join("audio").join("vo");
            tokio::fs::create_dir_all(&vo_dir)
                .await
                .map_err(|e| format!("Failed to create vo directory: {e}"))?;

            let raw_words: Vec<&str> = text.split_whitespace().collect();
            let mut words = Vec::new();
            let mut current_time = 0.1;

            for w in raw_words {
                let clean_word = w.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
                if clean_word.is_empty() {
                    continue;
                }
                let duration = (0.15 + (clean_word.len() as f64) * 0.04).round_to(2);
                let start = current_time.round_to(2);
                let end = (start + duration).round_to(2);
                words.push(WordTiming {
                    word: clean_word,
                    start,
                    end,
                });
                current_time = end + 0.05;
            }

            let total_duration = if words.is_empty() {
                0.5
            } else {
                (current_time + 0.1).round_to(2)
            };

            let line_timing = LineTiming {
                line_id: line_id.clone(),
                duration: total_duration,
                words: words.clone(),
            };

            let audio_filename = format!("{line_id}.mp3");
            let timing_filename = format!("{line_id}.timing.json");

            let audio_path = vo_dir.join(&audio_filename);
            let timing_path = vo_dir.join(&timing_filename);

            tokio::fs::write(&audio_path, SILENT_MP3_FRAME)
                .await
                .map_err(|e| format!("Failed to write audio file: {e}"))?;

            let json = serde_json::to_string_pretty(&line_timing)
                .map_err(|e| format!("Failed to serialize timing JSON: {e}"))?;
            tokio::fs::write(&timing_path, json)
                .await
                .map_err(|e| format!("Failed to write timing file: {e}"))?;

            Ok(TtsResult {
                line_id,
                audio_rel_path: format!("assets/audio/vo/{audio_filename}"),
                timing_rel_path: format!("assets/audio/vo/{timing_filename}"),
                duration: total_duration,
                words,
            })
        })
    }

    fn list_voices(&self) -> Vec<VoiceInfo> {
        vec![
            VoiceInfo {
                id: "mock-neutral".to_string(),
                name: "Mock Neutral".to_string(),
                language: "en-US".to_string(),
                gender: Some("neutral".to_string()),
            },
            VoiceInfo {
                id: "mock-narrator".to_string(),
                name: "Mock Narrator".to_string(),
                language: "en-US".to_string(),
                gender: Some("male".to_string()),
            },
        ]
    }
}

trait RoundTo {
    fn round_to(self, places: u32) -> f64;
}

impl RoundTo for f64 {
    fn round_to(self, places: u32) -> f64 {
        let mult = 10f64.powi(places as i32);
        (self * mult).round() / mult
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_mock_tts_generate() {
        let dir = tempdir().unwrap();
        let provider = MockTtsProvider::new();

        let res = provider
            .generate("intro-1", "Welcome to Liosvideo!", None, dir.path())
            .await
            .unwrap();

        assert_eq!(res.line_id, "intro-1");
        assert_eq!(res.audio_rel_path, "assets/audio/vo/intro-1.mp3");
        assert_eq!(res.timing_rel_path, "assets/audio/vo/intro-1.timing.json");
        assert_eq!(res.words.len(), 3);
        assert_eq!(res.words[0].word, "Welcome");
        assert_eq!(res.words[1].word, "to");
        assert_eq!(res.words[2].word, "Liosvideo");
        assert!(res.words[0].start < res.words[0].end);
        assert!(res.words[0].end <= res.words[1].start);
        assert!(res.duration >= res.words[2].end);

        // Verify files were actually written to disk
        let written_audio = dir.path().join("assets/audio/vo/intro-1.mp3");
        assert!(written_audio.exists());
        let written_timing = dir.path().join("assets/audio/vo/intro-1.timing.json");
        assert!(written_timing.exists());

        let timing_content = tokio::fs::read_to_string(written_timing).await.unwrap();
        let parsed: LineTiming = serde_json::from_str(&timing_content).unwrap();
        assert_eq!(parsed.line_id, "intro-1");
        assert_eq!(parsed.words.len(), 3);
    }

    #[test]
    fn test_mock_tts_list_voices() {
        let provider = MockTtsProvider::new();
        let voices = provider.list_voices();
        assert!(!voices.is_empty());
        assert_eq!(voices[0].id, "mock-neutral");
    }
}
