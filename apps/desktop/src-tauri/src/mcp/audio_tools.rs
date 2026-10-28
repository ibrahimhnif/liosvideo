use std::sync::Arc;
use serde_json::{json, Value};

use crate::audio::TtsProvider;
use crate::mcp::state_tools::EditorContext;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

pub struct TtsGenerateTool {
    context: Arc<EditorContext>,
    provider: Arc<dyn TtsProvider>,
}

impl TtsGenerateTool {
    pub fn new(context: Arc<EditorContext>, provider: Arc<dyn TtsProvider>) -> Self {
        Self { context, provider }
    }
}

impl Tool for TtsGenerateTool {
    fn name(&self) -> &'static str {
        "tts_generate"
    }

    fn description(&self) -> &'static str {
        "Generates spoken audio and word-level timestamp metadata (.timing.json) for a voiceover line."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "line_id": {
                    "type": "string",
                    "description": "Identifier for this voiceover line (e.g. 'intro-1', 'step-compile')"
                },
                "text": {
                    "type": "string",
                    "description": "The exact script text to synthesize"
                },
                "voice": {
                    "type": "string",
                    "description": "Optional voice ID (e.g. 'mock-neutral', 'mock-narrator')"
                }
            },
            "required": ["line_id", "text"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = self.context.clone();
        let provider = self.provider.clone();

        Box::pin(async move {
            let line_id = args
                .get("line_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "line_id is required and must not be empty".to_string())?
                .to_string();

            let text = args
                .get("text")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "text is required and must not be empty".to_string())?
                .to_string();

            let voice = args.get("voice").and_then(|v| v.as_str()).map(|s| s.to_string());

            let root = context.project_state.root().map_err(|e| e.to_string())?;

            let result = provider
                .generate(&line_id, &text, voice.as_deref(), &root)
                .await?;

            let provider_name = if voice.as_deref().unwrap_or("").starts_with("id-ID-")
                || voice.as_deref().unwrap_or("").starts_with("en-US-")
                || voice.as_deref().unwrap_or("").starts_with("en-GB-")
            {
                "google_cloud"
            } else if voice.as_deref().unwrap_or("").starts_with("mock-") {
                "mock"
            } else {
                "elevenlabs"
            };

            let stats = crate::project::record_tts_usage_in(
                &root,
                &line_id,
                provider_name,
                voice.as_deref().unwrap_or("default"),
                &text,
            ).ok();
            if let Some(s) = &stats {
                context.emitter.emit("project://stats_updated", json!(s));
            }

            Ok(json!({
                "line_id": result.line_id,
                "audio_path": result.audio_rel_path,
                "timing_path": result.timing_rel_path,
                "duration": result.duration,
                "words": result.words,
                "stats": stats
            }))
        })
    }
}

pub struct TtsListVoicesTool {
    provider: Arc<dyn TtsProvider>,
}

impl TtsListVoicesTool {
    pub fn new(provider: Arc<dyn TtsProvider>) -> Self {
        Self { provider }
    }
}

impl Tool for TtsListVoicesTool {
    fn name(&self) -> &'static str {
        "tts_list_voices"
    }

    fn description(&self) -> &'static str {
        "Lists available text-to-speech voices and their languages."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }

    fn call(&self, _args: Value) -> BoxFuture<Result<Value, String>> {
        let provider = self.provider.clone();
        Box::pin(async move {
            let voices = provider.list_voices();
            Ok(json!({ "voices": voices }))
        })
    }
}

pub fn register_audio_tools(
    registry: &mut ToolRegistry,
    context: Arc<EditorContext>,
    provider: Arc<dyn TtsProvider>,
) {
    registry.register(Arc::new(TtsGenerateTool::new(context, provider.clone())));
    registry.register(Arc::new(TtsListVoicesTool::new(provider)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::MockTtsProvider;
    use crate::mcp::protocol::handle_mcp_message;
    use crate::mcp::state_tools::NoopEventEmitter;
    use crate::project::ProjectState;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_tts_list_voices_mcp() {
        let mut registry = ToolRegistry::new();
        let project_state = ProjectState::default();
        let emitter = Arc::new(NoopEventEmitter);
        let context = Arc::new(EditorContext::new(project_state, emitter));
        let provider = Arc::new(MockTtsProvider::new());

        register_audio_tools(&mut registry, context, provider);

        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "tts_list_voices",
                "arguments": {}
            }
        });

        let resp_str = handle_mcp_message(&registry, &request.to_string()).await.unwrap();
        let resp: Value = serde_json::from_str(&resp_str).unwrap();

        assert_eq!(resp["result"]["content"][0]["type"], "text");
        let text_payload: Value = serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert!(text_payload["voices"].as_array().unwrap().len() >= 2);
    }

    #[tokio::test]
    async fn test_tts_generate_mcp() {
        let dir = tempdir().unwrap();
        let mut registry = ToolRegistry::new();
        let project_state = ProjectState::default();
        project_state.open_for_test(dir.path().to_path_buf());
        let emitter = Arc::new(NoopEventEmitter);
        let context = Arc::new(EditorContext::new(project_state, emitter));
        let provider = Arc::new(MockTtsProvider::new());

        register_audio_tools(&mut registry, context, provider);

        let request = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "tts_generate",
                "arguments": {
                    "line_id": "test-line",
                    "text": "Hello world from agent"
                }
            }
        });

        let resp_str = handle_mcp_message(&registry, &request.to_string()).await.unwrap();
        let resp: Value = serde_json::from_str(&resp_str).unwrap();

        assert_eq!(resp["result"]["content"][0]["type"], "text");
        let text_payload: Value = serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(text_payload["line_id"], "test-line");
        assert_eq!(text_payload["audio_path"], "assets/audio/vo/test-line.mp3");
        assert_eq!(text_payload["timing_path"], "assets/audio/vo/test-line.timing.json");
        assert_eq!(text_payload["words"].as_array().unwrap().len(), 4);

        // Verify file written to disk
        assert!(dir.path().join("assets/audio/vo/test-line.mp3").exists());
        assert!(dir.path().join("assets/audio/vo/test-line.timing.json").exists());
    }
}
