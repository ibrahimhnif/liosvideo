//! MCP tools that let a headless agent find and download freely licensed photos on Wikimedia Commons.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::commons;
use crate::mcp::headless_tools::SharedSession;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

pub fn register_commons_tools(registry: &mut ToolRegistry, session: SharedSession) {
    registry.register(Arc::new(SearchTool));
    registry.register(Arc::new(DownloadTool { session }));
}

struct DownloadTool {
    session: SharedSession,
}

struct SearchTool;

impl Tool for SearchTool {
    fn name(&self) -> &'static str {
        "commons_search"
    }

    fn description(&self) -> &'static str {
        "Search Wikimedia Commons for photos and drawings of real people, places, products and \
         events. Each hit has title, page URL, thumbnail, size, author and licence, and `reusable`: \
         only CC0, public domain, CC BY and CC BY-SA files can be downloaded (`refused` says why not)."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "e.g. \"Nayib Bukele\", \"Mac mini M4\"" },
                "page": { "type": "integer", "minimum": 1, "default": 1 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 12 }
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
            let page = args.get("page").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(12) as u32;
            let found = commons::search(&query, page, limit).await?;
            serde_json::to_value(found).map_err(|e| e.to_string())
        })
    }
}

impl Tool for DownloadTool {
    fn name(&self) -> &'static str {
        "commons_download"
    }

    fn description(&self) -> &'static str {
        "Download a Wikimedia Commons file into assets/images/ after checking its licence (CC0, \
         public domain, CC BY, CC BY-SA; anything else is refused with the reason), and write its \
         assets/ATTRIBUTIONS.md row. Returns relPath for image({ src }), `credit` (what \
         credit(root, { asset: relPath }) shows) and `descriptionCredit` for the video description."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "file": { "type": "string", "description": "Title from commons_search (\"File:Name.jpg\") or the file's commons.wikimedia.org URL" },
                "name": { "type": "string", "description": "Optional file name without extension (default: the Commons name)" },
                "width": { "type": "integer", "minimum": 64, "description": "Download a thumbnail this wide instead of the original (originals over 4096 px wide always come as a 3840 px thumbnail)" }
            },
            "required": ["file"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let file = args
                .get("file")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("file is required")?
                .to_string();
            let name = args.get("name").and_then(|v| v.as_str());
            let width = args.get("width").and_then(|v| v.as_u64()).map(|w| w as u32);
            let root = session
                .lock()
                .map(|s| s.project_root.clone())
                .map_err(|_| "session lock poisoned".to_string())?;
            let saved = commons::download(&root, &file, name, width, false).await?;
            serde_json::to_value(saved).map_err(|e| e.to_string())
        })
    }
}
