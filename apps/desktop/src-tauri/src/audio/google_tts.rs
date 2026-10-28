use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Deserialize;
use serde_json::json;

use super::tts::{LineTiming, TtsProvider, TtsResult, VoiceInfo, WordTiming};

pub struct GoogleCloudTtsProvider {
    api_key: Option<String>,
    client: reqwest::Client,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct Timepoint {
    #[serde(rename = "markName")]
    pub mark_name: Option<String>,
    #[serde(rename = "timeSeconds")]
    pub time_seconds: f64,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct GoogleTtsResponse {
    #[serde(rename = "audioContent")]
    audio_content: String,
    #[serde(default)]
    timepoints: Vec<Timepoint>,
}

impl GoogleCloudTtsProvider {
    pub fn new(api_key: Option<String>) -> Self {
        Self {
            api_key: api_key
                .or_else(|| crate::keychain::Keychain::get_secret("GOOGLE_TTS_API_KEY"))
                .or_else(|| crate::keychain::Keychain::get_secret("GOOGLE_API_KEY")),
            client: reqwest::Client::new(),
        }
    }

    pub fn has_key(&self) -> bool {
        self.api_key.as_ref().map(|k| !k.trim().is_empty()).unwrap_or(false)
    }

    pub fn estimate_word_timings(text: &str, duration: f64) -> Vec<WordTiming> {
        let words: Vec<&str> = text.split_whitespace().collect();
        if words.is_empty() {
            return Vec::new();
        }

        let total_chars: usize = words.iter().map(|w| w.chars().count()).sum();
        let total_chars = if total_chars == 0 { 1 } else { total_chars };

        let mut result = Vec::new();
        let mut current_time: f64 = 0.0;

        for (i, word) in words.iter().enumerate() {
            let clean = word.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
            let char_len = word.chars().count().max(1);
            let proportion = char_len as f64 / total_chars as f64;
            let word_duration = (proportion * duration).max(0.05);

            let start = (current_time * 100.0).round() / 100.0;
            let end = if i == words.len() - 1 {
                (duration * 100.0).round() / 100.0
            } else {
                ((current_time + word_duration) * 100.0).round() / 100.0
            };

            if !clean.is_empty() {
                result.push(WordTiming {
                    word: clean,
                    start,
                    end,
                });
            }
            current_time += word_duration;
        }

        result
    }
}

impl TtsProvider for GoogleCloudTtsProvider {
    fn generate(
        &self,
        line_id: &str,
        text: &str,
        voice: Option<&str>,
        project_root: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<TtsResult, String>> + Send>> {
        let api_key = self.api_key.clone();
        let client = self.client.clone();
        let line_id = line_id.to_string();
        let text = text.to_string();
        let default_voice = crate::keychain::Keychain::get_secret("DEFAULT_TTS_VOICE")
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "id-ID-Neural2-A".to_string());
        let voice_name = voice.unwrap_or(&default_voice).to_string();
        let project_root = project_root.to_path_buf();

        Box::pin(async move {
            let key = match api_key {
                Some(k) if !k.trim().is_empty() => k,
                _ => return Err("Google Cloud TTS API key not configured (set GOOGLE_TTS_API_KEY)".to_string()),
            };

            let language_code = if voice_name.starts_with("id-") {
                "id-ID".to_string()
            } else if voice_name.starts_with("en-GB") {
                "en-GB".to_string()
            } else {
                let parts: Vec<&str> = voice_name.split('-').collect();
                if parts.len() >= 2 && parts[0].len() == 2 && parts[1].len() == 2 {
                    format!("{}-{}", parts[0], parts[1])
                } else {
                    "en-US".to_string()
                }
            };

            let payload = json!({
                "input": {
                    "text": text
                },
                "voice": {
                    "languageCode": language_code,
                    "name": voice_name
                },
                "audioConfig": {
                    "audioEncoding": "MP3"
                }
            });

            let url = format!("https://texttospeech.googleapis.com/v1/text:synthesize?key={key}");
            let response = client
                .post(&url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("Failed to request Google Cloud TTS: {e}"))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!("Google Cloud TTS API error ({status}): {body}"));
            }

            let tts_res: GoogleTtsResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Google Cloud TTS response: {e}"))?;

            let audio_bytes = BASE64
                .decode(tts_res.audio_content.trim())
                .map_err(|e| format!("Failed to decode base64 audio: {e}"))?;

            // Approximate duration from MP3 bytes or length
            let duration = ((audio_bytes.len() as f64 * 8.0) / 128_000.0).max(0.5);
            let duration = (duration * 100.0).round() / 100.0;

            let words = Self::estimate_word_timings(&text, duration);

            let audio_rel = format!("assets/audio/vo/{line_id}.mp3");
            let timing_rel = format!("assets/audio/vo/{line_id}.timing.json");

            let audio_path = project_root.join(&audio_rel);
            let timing_path = project_root.join(&timing_rel);

            if let Some(parent) = audio_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("Failed to create vo directory: {e}"))?;
            }

            tokio::fs::write(&audio_path, &audio_bytes)
                .await
                .map_err(|e| format!("Failed to write audio file: {e}"))?;

            let line_timing = LineTiming {
                line_id: line_id.clone(),
                duration,
                words: words.clone(),
            };

            let timing_json = serde_json::to_string_pretty(&line_timing)
                .map_err(|e| format!("Failed to serialize timing: {e}"))?;

            tokio::fs::write(&timing_path, timing_json)
                .await
                .map_err(|e| format!("Failed to write timing file: {e}"))?;

            Ok(TtsResult {
                line_id,
                audio_rel_path: audio_rel,
                timing_rel_path: timing_rel,
                duration,
                words,
            })
        })
    }

    fn list_voices(&self) -> Vec<VoiceInfo> {
        vec![
            VoiceInfo {
                id: "id-ID-Neural2-A".into(),
                name: "Indonesian Neural2 Female (id-ID)".into(),
                language: "id-ID".into(),
                gender: Some("female".into()),
            },
            VoiceInfo {
                id: "id-ID-Neural2-B".into(),
                name: "Indonesian Neural2 Male (id-ID)".into(),
                language: "id-ID".into(),
                gender: Some("male".into()),
            },
            VoiceInfo {
                id: "id-ID-Wavenet-A".into(),
                name: "Indonesian Wavenet Female (id-ID)".into(),
                language: "id-ID".into(),
                gender: Some("female".into()),
            },
            VoiceInfo {
                id: "id-ID-Wavenet-B".into(),
                name: "Indonesian Wavenet Male (id-ID)".into(),
                language: "id-ID".into(),
                gender: Some("male".into()),
            },
            VoiceInfo {
                id: "id-ID-Wavenet-C".into(),
                name: "Indonesian Wavenet Male 2 (id-ID)".into(),
                language: "id-ID".into(),
                gender: Some("male".into()),
            },
            VoiceInfo {
                id: "id-ID-Wavenet-D".into(),
                name: "Indonesian Wavenet Female 2 (id-ID)".into(),
                language: "id-ID".into(),
                gender: Some("female".into()),
            },
            VoiceInfo {
                id: "en-US-Journey-F".into(),
                name: "Journey Female (en-US)".into(),
                language: "en-US".into(),
                gender: Some("female".into()),
            },
            VoiceInfo {
                id: "en-US-Journey-D".into(),
                name: "Journey Male (en-US)".into(),
                language: "en-US".into(),
                gender: Some("male".into()),
            },
            VoiceInfo {
                id: "en-US-Neural2-F".into(),
                name: "Neural2 Female (en-US)".into(),
                language: "en-US".into(),
                gender: Some("female".into()),
            },
            VoiceInfo {
                id: "en-US-Neural2-D".into(),
                name: "Neural2 Male (en-US)".into(),
                language: "en-US".into(),
                gender: Some("male".into()),
            },
            VoiceInfo {
                id: "en-US-Studio-O".into(),
                name: "Studio Female (en-US)".into(),
                language: "en-US".into(),
                gender: Some("female".into()),
            },
        ]
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_estimate_word_timings() {
        let text = "Welcome to liosvideo engine";
        let duration = 2.0;
        let timings = GoogleCloudTtsProvider::estimate_word_timings(text, duration);

        assert_eq!(timings.len(), 4);
        assert_eq!(timings[0].word, "Welcome");
        assert_eq!(timings[1].word, "to");
        assert_eq!(timings[2].word, "liosvideo");
        assert_eq!(timings[3].word, "engine");

        assert_eq!(timings[0].start, 0.0);
        assert_eq!(timings[3].end, 2.0);
    }

    #[test]
    fn test_google_cloud_tts_provider_without_key_reports_error() {
        let provider = GoogleCloudTtsProvider::new(None);
        let temp_dir = tempfile::tempdir().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();

        let result = rt.block_on(provider.generate("test-1", "Test", None, temp_dir.path()));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("API key not configured"));
    }

    #[test]
    fn test_google_cloud_tts_list_voices() {
        let provider = GoogleCloudTtsProvider::new(None);
        let voices = provider.list_voices();
        assert!(!voices.is_empty());
        assert!(voices.iter().any(|v| v.id == "en-US-Journey-F"));
    }
}
