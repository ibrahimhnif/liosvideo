//! MCP tools that let a headless agent generate and revise images with Google Gemini.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::imagegen;
use crate::mcp::headless_tools::SharedSession;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};
use crate::project::keychain::Keychain;

pub fn register_image_tools(registry: &mut ToolRegistry, session: SharedSession) {
    registry.register(Arc::new(GenerateTool { session: Arc::clone(&session) }));
    registry.register(Arc::new(EditTool { session }));
}

fn session_root(session: &SharedSession) -> Result<std::path::PathBuf, String> {
    session
        .lock()
        .map(|s| s.project_root.clone())
        .map_err(|_| "session lock poisoned".to_string())
}

fn api_key() -> String {
    imagegen::KEY_NAMES
        .iter()
        .find_map(|name| Keychain::get_secret(name))
        .unwrap_or_default()
}

fn str_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn result(entry: &imagegen::ImageEntry) -> Value {
    json!({
        "id": entry.id,
        "src": entry.src,
        "version": entry.active,
        "versions": entry.versions.len(),
        "usage": format!("image({{ src: \"{}\", fit: \"cover\" }})", entry.src),
        "note": "AI-generated: recorded in assets/ATTRIBUTIONS.md. Never present it as a real photo of a real person or event.",
    })
}

struct GenerateTool {
    session: SharedSession,
}

impl Tool for GenerateTool {
    fn name(&self) -> &'static str {
        "image_generate"
    }

    fn description(&self) -> &'static str {
        "Generate an image with Google Gemini (Nano Banana) and save it as assets/images/<id>.png. \
         Use for illustrations, backgrounds, concepts and reconstructions; prefer real photos/archive \
         footage for real people and events. Pass `refs` (project image paths) to keep a character, \
         product or style consistent. Calling again with the same id adds a new version."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "Subject, setting, lighting, style and framing" },
                "id": { "type": "string", "description": "Asset id, e.g. \"palace-night\" → assets/images/palace-night.png" },
                "aspect": { "type": "string", "enum": imagegen::ASPECTS, "description": "Default: 9:16 for short-only projects, else 16:9" },
                "size": { "type": "string", "enum": imagegen::SIZES },
                "refs": { "type": "array", "items": { "type": "string" }, "description": "Reference images inside the project" }
            },
            "required": ["prompt", "id"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let prompt = str_arg(&args, "prompt").ok_or("prompt is required")?;
            let id = str_arg(&args, "id").ok_or("id is required")?;
            let refs = args
                .get("refs")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|r| r.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            let opts = imagegen::GenerateOptions {
                aspect: str_arg(&args, "aspect"),
                size: str_arg(&args, "size"),
                model: None,
                refs,
            };
            let root = session_root(&session)?;
            let entry = imagegen::generate(&root, &api_key(), &id, &prompt, opts).await?;
            Ok(result(&entry))
        })
    }
}

struct EditTool {
    session: SharedSession,
}

impl Tool for EditTool {
    fn name(&self) -> &'static str {
        "image_edit"
    }

    fn description(&self) -> &'static str {
        "Revise a generated image with a plain instruction (\"darker sky\", \"remove the text\", \
         \"less saturated\"). The active version is the base; the result becomes a new active version \
         at the same assets/images/<id>.png path, so scenes pick it up without code changes."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Id used with image_generate" },
                "instruction": { "type": "string", "description": "What to change" }
            },
            "required": ["id", "instruction"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let id = str_arg(&args, "id").ok_or("id is required")?;
            let instruction = str_arg(&args, "instruction").ok_or("instruction is required")?;
            let root = session_root(&session)?;
            let entry = imagegen::edit(&root, &api_key(), &id, &instruction, None).await?;
            Ok(result(&entry))
        })
    }
}
