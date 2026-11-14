//! `video_matte`: cuts the person out of a project video (MODNet on the GPU) into
//! `<name>.matte.mp4`, which `video({ matte: true })` plays as a cut-out.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::matte;
use crate::mcp::headless_tools::SharedSession;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

pub fn register_matte_tools(registry: &mut ToolRegistry, session: SharedSession) {
    registry.register(Arc::new(MatteTool { session }));
}

struct MatteTool {
    session: SharedSession,
}

impl Tool for MatteTool {
    fn name(&self) -> &'static str {
        "video_matte"
    }

    fn description(&self) -> &'static str {
        "Cut the person out of a project video (MODNet portrait matting on the GPU) into \
         <name>.matte.mp4 next to it, once; renders only read that file. Then use \
         video({ src, matte: true }) for the cut-out, and group({ sticker: 8 }) around it for a \
         sticker outline, or put text between the full video and the cut-out. People only: objects \
         they hold are not kept. MP4 with H.264. The model (26 MB) downloads on first use."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "video": { "type": "string", "description": "Project video, e.g. \"assets/video/talk.mp4\"" },
                "quality": { "type": "string", "enum": ["fast", "balanced", "best"], "default": "fast",
                             "description": "fast is plenty for outlines and cut-outs; best gives finer hair" },
                "force": { "type": "boolean", "default": false, "description": "Make it again when it exists" }
            },
            "required": ["video"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let video = args
                .get("video")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("video is required")?
                .to_string();
            let quality = matte::Quality::parse(args.get("quality").and_then(|v| v.as_str()).unwrap_or("fast"))
                .map_err(|e| e.to_string())?;
            let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
            let root: PathBuf = session
                .lock()
                .map(|s| s.project_root.clone())
                .map_err(|_| "session lock poisoned".to_string())?;
            let src = matte::project_relative(&root, &video).map_err(|e| e.to_string())?;
            let made = matte::make(root, src, matte::MatteOptions { quality, force }, |_| {}, |_, _| {})
                .await
                .map_err(|e| format!("{e:#}"))?;
            serde_json::to_value(made).map_err(|e| e.to_string())
        })
    }
}
