pub mod elevenlabs;
pub mod google_tts;
pub mod tts;

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

pub use elevenlabs::ElevenLabsTtsProvider;
pub use google_tts::GoogleCloudTtsProvider;
pub use tts::{LineTiming, MockTtsProvider, TtsProvider, TtsResult, VoiceInfo, WordTiming};

pub struct UnifiedTtsProvider {
    eleven: ElevenLabsTtsProvider,
    google: GoogleCloudTtsProvider,
    mock: MockTtsProvider,
}

impl Default for UnifiedTtsProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl UnifiedTtsProvider {
    pub fn new() -> Self {
        Self {
            eleven: ElevenLabsTtsProvider::new(None),
            google: GoogleCloudTtsProvider::new(None),
            mock: MockTtsProvider::new(),
        }
    }

    pub fn with_providers(
        eleven: ElevenLabsTtsProvider,
        google: GoogleCloudTtsProvider,
        mock: MockTtsProvider,
    ) -> Self {
        Self { eleven, google, mock }
    }
}

impl TtsProvider for UnifiedTtsProvider {
    fn generate(
        &self,
        line_id: &str,
        text: &str,
        voice: Option<&str>,
        project_root: &Path,
    ) -> Pin<Box<dyn Future<Output = Result<TtsResult, String>> + Send>> {
        let voice_req = voice.map(|s| s.to_string());
        let default_pref = crate::keychain::Keychain::get_secret("DEFAULT_TTS_VOICE");
        let active_voice = voice_req.or(default_pref);

        let is_google_voice = if let Some(ref v) = active_voice {
            v.starts_with("id-ID-") || v.starts_with("en-US-") || v.starts_with("en-GB-")
        } else {
            false
        };

        let is_mock_voice = if let Some(ref v) = active_voice {
            v.starts_with("mock-")
        } else {
            false
        };

        if is_mock_voice {
            return self.mock.generate(line_id, text, active_voice.as_deref(), project_root);
        }

        if is_google_voice && self.google.has_key() {
            return self.google.generate(line_id, text, active_voice.as_deref(), project_root);
        }

        if self.eleven.has_key() && !is_google_voice {
            return self.eleven.generate(line_id, text, active_voice.as_deref(), project_root);
        }

        if self.google.has_key() {
            return self.google.generate(line_id, text, active_voice.as_deref(), project_root);
        }

        self.mock.generate(line_id, text, active_voice.as_deref(), project_root)
    }

    fn list_voices(&self) -> Vec<VoiceInfo> {
        let mut list = Vec::new();
        if self.eleven.has_key() {
            list.extend(self.eleven.list_voices());
        }
        if self.google.has_key() {
            list.extend(self.google.list_voices());
        }
        if list.is_empty() {
            list.extend(self.mock.list_voices());
        }
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unified_tts_list_voices() {
        let provider = UnifiedTtsProvider::new();
        let voices = provider.list_voices();
        assert!(!voices.is_empty());
        assert!(voices.iter().any(|v| v.language.contains("id") || v.language.contains("en")));
    }

    #[tokio::test]
    async fn test_unified_tts_generate_routes_to_mock_when_no_keys() {
        let provider = UnifiedTtsProvider::new();
        let temp = tempfile::tempdir().unwrap();
        let res = provider.generate("u-1", "Halo dunia", Some("mock-id-male"), temp.path()).await.unwrap();
        assert_eq!(res.line_id, "u-1");
        assert_eq!(res.words.len(), 2);
    }
}
