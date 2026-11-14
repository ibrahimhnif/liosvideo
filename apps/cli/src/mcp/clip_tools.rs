//! `youtube_download`, `video_transcript` and `video_transcribe`: long videos and their transcripts,
//! the source for short clips. The tools themselves live in `crate::youtube` (shared with the app).

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;

use crate::mcp::headless_tools::SharedSession;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};
use crate::youtube;

pub fn register_clip_tools(registry: &mut ToolRegistry, session: SharedSession) {
    for name in youtube::TOOL_NAMES {
        registry.register(Arc::new(ClipTool { name, session: session.clone() }));
    }
}

pub fn elevenlabs_key() -> Option<String> {
    std::env::var("ELEVENLABS_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .or_else(|| crate::project::keychain::Keychain::get_secret("ELEVENLABS_API_KEY"))
}

struct ClipTool {
    name: &'static str,
    session: SharedSession,
}

impl Tool for ClipTool {
    fn name(&self) -> &'static str {
        self.name
    }

    fn description(&self) -> &'static str {
        youtube::tool_description(self.name)
    }

    fn input_schema(&self) -> Value {
        youtube::tool_schema(self.name)
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let (name, session) = (self.name, Arc::clone(&self.session));
        Box::pin(async move {
            let root: PathBuf = session
                .lock()
                .map(|s| s.project_root.clone())
                .map_err(|_| "session lock poisoned".to_string())?;
            youtube::call_tool(name, &root, args, elevenlabs_key()).await
        })
    }
}
