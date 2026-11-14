//! `video_matte` in the desktop app: same tool as the CLI's, run through the `liosvideo` CLI
//! (see matte_cli.rs).

use std::sync::Arc;

use serde_json::{json, Value};

use crate::matte_cli;
use crate::mcp::state_tools::EditorContext;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

pub fn register_matte_tools(registry: &mut ToolRegistry, context: Arc<EditorContext>) {
    registry.register(Arc::new(MatteTool { context }));
}

struct MatteTool {
    context: Arc<EditorContext>,
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
         they hold are not kept. MP4 with H.264. Runs the liosvideo CLI; the error says how to \
         install it if it is missing."
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
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let video = args.get("video").and_then(|v| v.as_str()).ok_or("video is required")?.to_string();
            let quality = args.get("quality").and_then(|v| v.as_str()).map(str::to_string);
            let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
            let root = context.project_state.root().map_err(|e| e.to_string())?;
            matte_cli::matte(&root, &video, quality.as_deref(), force).await
        })
    }
}

pub fn register_reframe_tool(registry: &mut ToolRegistry, context: Arc<EditorContext>) {
    registry.register(Arc::new(ReframeTool { context }));
}

struct ReframeTool {
    context: Arc<EditorContext>,
}

impl Tool for ReframeTool {
    fn name(&self) -> &'static str {
        "video_reframe"
    }

    fn description(&self) -> &'static str {
        "Follow the speaker in a clip made by video_clip, so clipVideo keeps them in frame when 16:9 \
         footage fills a 9:16 short: MODNet finds the people a few times a second, the crop holds still \
         unless they move and jumps with camera cuts. Stores the path in the clip's VO line; clipVideo \
         uses it on the next render. Runs the liosvideo CLI; the error says how to install it if it is missing."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Clip id from video_clip, e.g. \"clip-01\"" },
                "aspect": { "type": "string", "default": "9:16", "description": "The short's shape" }
            },
            "required": ["id"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let id = args.get("id").and_then(|v| v.as_str()).ok_or("id is required")?.to_string();
            let aspect = args.get("aspect").and_then(|v| v.as_str()).map(str::to_string);
            let root = context.project_state.root().map_err(|e| e.to_string())?;
            matte_cli::reframe(&root, &id, aspect.as_deref()).await
        })
    }
}
