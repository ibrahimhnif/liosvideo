use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Deserialize;
use serde_json::json;

use super::tts::{LineTiming, TtsProvider, TtsResult, VoiceInfo, WordTiming};

pub struct ElevenLabsTtsProvider {
    api_key: Option<String>,
    client: reqwest::Client,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlignmentData {
    pub characters: Vec<String>,
    pub character_start_times_seconds: Vec<f64>,
    pub character_end_times_seconds: Vec<f64>,
}

#[derive(Deserialize)]
struct TtsResponse {
    audio_base64: String,
    alignment: AlignmentData,
}

impl ElevenLabsTtsProvider {
    pub fn new(api_key: Option<String>) -> Self {
        Self {
            api_key: api_key.or_else(|| std::env::var("ELEVENLABS_API_KEY").ok()),
            client: reqwest::Client::new(),
        }
    }

    pub fn has_key(&self) -> bool {
        self.api_key.as_ref().map(|k| !k.trim().is_empty()).unwrap_or(false)
    }

    pub fn parse_alignment_to_words(alignment: &AlignmentData) -> Vec<WordTiming> {
        let mut words = Vec::new();
        let mut current_word = String::new();
        let mut word_start: Option<f64> = None;
        let mut word_end: f64 = 0.0;

        for (i, char_str) in alignment.characters.iter().enumerate() {
            let start = alignment.character_start_times_seconds.get(i).copied().unwrap_or(0.0);
            let end = alignment.character_end_times_seconds.get(i).copied().unwrap_or(start);

            if char_str.trim().is_empty() {
                if !current_word.is_empty() {
                    let clean = current_word.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
                    if !clean.is_empty() {
                        words.push(WordTiming {
                            word: clean,
                            start: (word_start.unwrap_or(0.0) * 100.0).round() / 100.0,
                            end: (word_end * 100.0).round() / 100.0,
                        });
                    }
                    current_word.clear();
                    word_start = None;
                }
            } else {
                if word_start.is_none() {
                    word_start = Some(start);
                }
                word_end = end;
                current_word.push_str(char_str);
            }
        }

        if !current_word.is_empty() {
            let clean = current_word.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
            if !clean.is_empty() {
                words.push(WordTiming {
                    word: clean,
                    start: (word_start.unwrap_or(0.0) * 100.0).round() / 100.0,
                    end: (word_end * 100.0).round() / 100.0,
                });
            }
        }

        words
    }
}

impl TtsProvider for ElevenLabsTtsProvider {
    fn generate(
        &self,
        line_id: &str,
        text: &str,
        voice: Option<&str>,
        project_root: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<TtsResult, String>> + Send>> {
        let api_key = match &self.api_key {
            Some(k) if !k.trim().is_empty() => k.clone(),
            _ => {
                return Box::pin(async {
                    Err("ELEVENLABS_API_KEY is not configured".to_string())
                });
            }
        };

        let client = self.client.clone();
        let voice_id = voice.unwrap_or("21m00Tcm4TlvDq8ikWAM").to_string(); // Rachel default
        let line_id = line_id.to_string();
        let text = text.to_string();
        let project_root = project_root.to_path_buf();

        Box::pin(async move {
            let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps");

            let res = client
                .post(&url)
                .header("xi-api-key", &api_key)
                .header("Content-Type", "application/json")
                .json(&json!({
                    "text": text,
                    "model_id": "eleven_multilingual_v2"
                }))
                .send()
                .await
                .map_err(|e| format!("ElevenLabs request failed: {e}"))?;

            if !res.status().is_success() {
                let err_text = res.text().await.unwrap_or_default();
                return Err(format!("ElevenLabs API error: {err_text}"));
            }

            let tts_resp: TtsResponse = res
                .json()
                .await
                .map_err(|e| format!("Failed to parse ElevenLabs response: {e}"))?;

            let words = Self::parse_alignment_to_words(&tts_resp.alignment);
            let duration = words.last().map(|w| w.end + 0.1).unwrap_or(1.0);

            let audio_bytes = BASE64
                .decode(&tts_resp.audio_base64)
                .map_err(|e| format!("Failed to decode base64 audio: {e}"))?;

            let vo_dir = project_root.join("assets").join("audio").join("vo");
            tokio::fs::create_dir_all(&vo_dir)
                .await
                .map_err(|e| format!("Failed to create vo directory: {e}"))?;

            let audio_filename = format!("{line_id}.mp3");
            let timing_filename = format!("{line_id}.timing.json");

            tokio::fs::write(vo_dir.join(&audio_filename), audio_bytes)
                .await
                .map_err(|e| format!("Failed to write audio file: {e}"))?;

            let timing_json = serde_json::to_string_pretty(&LineTiming {
                line_id: line_id.clone(),
                duration,
                words: words.clone(),
            })
            .map_err(|e| format!("Failed to serialize timing: {e}"))?;

            tokio::fs::write(vo_dir.join(&timing_filename), timing_json)
                .await
                .map_err(|e| format!("Failed to write timing file: {e}"))?;

            Ok(TtsResult {
                line_id,
                audio_rel_path: format!("assets/audio/vo/{audio_filename}"),
                timing_rel_path: format!("assets/audio/vo/{timing_filename}"),
                duration,
                words,
            })
        })
    }

    fn list_voices(&self) -> Vec<VoiceInfo> {
        vec![
            VoiceInfo {
                id: "21m00Tcm4TlvDq8ikWAM".to_string(),
                name: "Rachel (Calm & Professional)".to_string(),
                language: "en-US".to_string(),
                gender: Some("female".to_string()),
            },
            VoiceInfo {
                id: "pNInz6obpgDQGcFmaJgB".to_string(),
                name: "Adam (Deep & Narrator)".to_string(),
                language: "en-US".to_string(),
                gender: Some("male".to_string()),
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_alignment_to_words() {
        let alignment = AlignmentData {
            characters: vec![
                "H".into(), "e".into(), "l".into(), "l".into(), "o".into(),
                " ".into(),
                "w".into(), "o".into(), "r".into(), "l".into(), "d".into(), "!".into()
            ],
            character_start_times_seconds: vec![
                0.0, 0.05, 0.10, 0.15, 0.20,
                0.25,
                0.30, 0.35, 0.40, 0.45, 0.50, 0.55
            ],
            character_end_times_seconds: vec![
                0.05, 0.10, 0.15, 0.20, 0.25,
                0.30,
                0.35, 0.40, 0.45, 0.50, 0.55, 0.60
            ],
        };

        let words = ElevenLabsTtsProvider::parse_alignment_to_words(&alignment);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].word, "Hello");
        assert_eq!(words[0].start, 0.0);
        assert_eq!(words[0].end, 0.25);
        assert_eq!(words[1].word, "world");
        assert_eq!(words[1].start, 0.3);
        assert_eq!(words[1].end, 0.6);
    }

    #[test]
    fn test_elevenlabs_provider_without_key_reports_error() {
        let provider = ElevenLabsTtsProvider::new(None);
        // If ELEVENLABS_API_KEY environment variable is not set
        if !provider.has_key() {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let res = rt.block_on(provider.generate("test", "test", None, Path::new(".")));
            assert!(res.is_err());
            assert!(res.unwrap_err().contains("ELEVENLABS_API_KEY"));
        }
    }
}
