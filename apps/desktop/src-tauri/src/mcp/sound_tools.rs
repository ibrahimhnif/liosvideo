//! MCP tools for sound effects and music: freely licensed recordings from Openverse (Freesound,
//! Jamendo, Wikimedia Commons audio) and sounds made in code by earshot, when it is installed.
//!
//! `openverse_search`   — search with each file's licence checked.
//! `openverse_download` — saves into `assets/audio/sfx|music/` and records the attribution row.
//! `earshot_sfx_list`   — the earshot sound bank.
//! `earshot_sfx_render` — renders a bank sound into `assets/audio/sfx/<name>.wav`.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::mcp::state_tools::EditorContext;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};
use crate::{earshot, openverse};

pub fn register_sound_tools(registry: &mut ToolRegistry, context: Arc<EditorContext>) {
    registry.register(Arc::new(SearchTool));
    registry.register(Arc::new(DownloadTool { context: context.clone() }));
    registry.register(Arc::new(EarshotListTool));
    registry.register(Arc::new(EarshotRenderTool { context }));
}

fn project_root(context: &EditorContext) -> Result<std::path::PathBuf, String> {
    context.project_state.root().map_err(|e| e.to_string())
}

fn kind_arg(args: &Value) -> Result<Option<openverse::Kind>, String> {
    match args.get("kind").and_then(|v| v.as_str()) {
        Some(kind) => openverse::Kind::parse(kind),
        None => Ok(None),
    }
}

struct SearchTool;

impl Tool for SearchTool {
    fn name(&self) -> &'static str {
        "openverse_search"
    }

    fn description(&self) -> &'static str {
        "Search Openverse for freely licensed sound effects (Freesound) and music (Jamendo, \
         Wikimedia Commons audio). Each hit has id, title, creator, licence, duration, tags, \
         page URL and previewUrl (the file, to listen first), and `reusable`: only CC0, public \
         domain, CC BY and CC BY-SA can be downloaded. Anonymous use allows about 20 searches a \
         minute and 200 a day, so search with specific words."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "e.g. \"whoosh fast\", \"camera shutter\", \"calm piano\"" },
                "kind": { "type": "string", "enum": ["sfx", "music", "any"], "default": "any",
                          "description": "sfx: Freesound; music: Jamendo and Wikimedia Commons audio" },
                "page": { "type": "integer", "minimum": 1, "default": 1 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 10 }
            },
            "required": ["query"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        Box::pin(async move {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|q| !q.is_empty())
                .ok_or("query is required")?
                .to_string();
            let kind = kind_arg(&args)?;
            let page = args.get("page").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as u32;
            let found = openverse::search(&query, kind, page, limit).await?;
            serde_json::to_value(found).map_err(|e| e.to_string())
        })
    }
}

struct DownloadTool {
    context: Arc<EditorContext>,
}

impl Tool for DownloadTool {
    fn name(&self) -> &'static str {
        "openverse_download"
    }

    fn description(&self) -> &'static str {
        "Download an Openverse audio file after checking its licence (CC0, public domain, CC BY, \
         CC BY-SA; anything else is refused with the reason) into assets/audio/sfx/ or \
         assets/audio/music/, and write its assets/ATTRIBUTIONS.md row. Returns relPath, `usage` \
         (how to use it in a composition), `credit` (what credit(root, { asset: relPath }) shows) \
         and `descriptionCredit` for the video description (CC BY needs it there)."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The id from openverse_search, or an openverse.org/audio/<id> URL" },
                "kind": { "type": "string", "enum": ["sfx", "music"], "description": "Folder to save into (default: from the source and length)" },
                "name": { "type": "string", "description": "Optional file name without extension, e.g. \"whoosh\" (default: the title)" }
            },
            "required": ["id"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("id is required")?
                .to_string();
            let kind = kind_arg(&args)?;
            let name = args.get("name").and_then(|v| v.as_str());
            let root = project_root(&context)?;
            let saved = openverse::download(&root, &id, kind, name, false).await?;
            serde_json::to_value(saved).map_err(|e| e.to_string())
        })
    }
}

struct EarshotListTool;

impl Tool for EarshotListTool {
    fn name(&self) -> &'static str {
        "earshot_sfx_list"
    }

    fn description(&self) -> &'static str {
        "List earshot's bank of sound effects made in code (whooshes, swishes, risers, hits, sub \
         drops, clicks, taps, pops, dings, shutters, glitches, mallet notes): ids, lengths, peak \
         times and knobs. Needs the earshot tool installed; the error says how if it is not."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "kind": { "type": "string", "description": "Only one kind, e.g. \"whoosh\", \"pop\", \"click\", \"riser\"" }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        Box::pin(async move {
            let kind = args.get("kind").and_then(|v| v.as_str()).map(str::to_string);
            earshot::list(kind.as_deref()).await
        })
    }
}

struct EarshotRenderTool {
    context: Arc<EditorContext>,
}

impl Tool for EarshotRenderTool {
    fn name(&self) -> &'static str {
        "earshot_sfx_render"
    }

    fn description(&self) -> &'static str {
        "Render a sound from earshot's bank (made in code, MIT, no attribution on screen needed) \
         into assets/audio/sfx/<name>.wav, aimed at a move: `dur` sets its length, `apex` when a \
         whoosh peaks, `pitch` tunes a tonal sound (\"E5\"), `seed` gives another take. Use it with \
         `sfx: \"<name>\"` on the move. Needs the earshot tool installed."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Bank id from earshot_sfx_list, e.g. \"whoosh_fast/crisp\", \"ui_pop/soft\"" },
                "name": { "type": "string", "description": "File name without extension (default: the id with / as -)" },
                "dur": { "type": "number", "description": "Length in seconds" },
                "apex": { "type": "number", "description": "Seconds from the start to the whoosh's loudest moment" },
                "pitch": { "type": "string", "description": "Note (\"E5\") or Hz, for tonal sounds" },
                "seed": { "type": "integer", "minimum": 0 }
            },
            "required": ["id"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("id is required")?
                .to_string();
            let opts = earshot::RenderOptions {
                name: args.get("name").and_then(|v| v.as_str()).map(str::to_string),
                dur: args.get("dur").and_then(|v| v.as_f64()),
                apex: args.get("apex").and_then(|v| v.as_f64()),
                pitch: args
                    .get("pitch")
                    .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_f64().map(|n| n.to_string()))),
                seed: args.get("seed").and_then(|v| v.as_u64()),
                force: false,
            };
            let root = project_root(&context)?;
            let rendered = earshot::render(&root, &id, &opts).await?;
            serde_json::to_value(rendered).map_err(|e| e.to_string())
        })
    }
}
