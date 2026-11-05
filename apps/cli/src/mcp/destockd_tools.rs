//! MCP tools that let a headless agent find and download free archival footage from Destockd.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::destockd;
use crate::mcp::headless_tools::SharedSession;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

const MAX_HITS: usize = 12;

pub fn register_destockd_tools(registry: &mut ToolRegistry, session: SharedSession) {
    registry.register(Arc::new(SearchTool));
    registry.register(Arc::new(DownloadTool { session }));
}

fn session_root(session: &SharedSession) -> Result<std::path::PathBuf, String> {
    session
        .lock()
        .map(|s| s.project_root.clone())
        .map_err(|_| "session lock poisoned".to_string())
}

struct SearchTool;

impl Tool for SearchTool {
    fn name(&self) -> &'static str {
        "destockd_search"
    }

    fn description(&self) -> &'static str {
        "Search FREE archival footage (US government / FedFlix, public domain or unrestricted) by \
         describing what should be on screen. Returns film, shot, clip MP4 URL, preview and keyframe. \
         Rights are not certified per clip: record the source in assets/ATTRIBUTIONS.md."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Visual description, e.g. \"aircraft carrier at sea\"" },
                "page": { "type": "integer", "minimum": 1, "default": 1 },
                "include_disturbing": {
                    "type": "boolean",
                    "default": false,
                    "description": "Include footage Destockd hides from its homepage (historical violence/nudity)"
                }
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
            let include_disturbing = args
                .get("include_disturbing")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let found = destockd::search(&query, page, include_disturbing).await?;
            let hits: Vec<&destockd::Hit> = found.hits.iter().take(MAX_HITS).collect();
            Ok(json!({
                "query": found.query,
                "page": found.page,
                "hasMore": found.has_more,
                "total": found.hits.len(),
                "hits": hits,
                "rights": destockd::RIGHTS_NOTICE,
            }))
        })
    }
}

struct DownloadTool {
    session: SharedSession,
}

impl Tool for DownloadTool {
    fn name(&self) -> &'static str {
        "destockd_download"
    }

    fn description(&self) -> &'static str {
        "Download a Destockd shot into assets/video/ and append its attribution row. Returns the \
         relative path to pass to video({ src }). Verify the source record before commercial use."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "film": { "type": "string", "description": "Film name from destockd_search" },
                "shot": { "type": "string", "description": "Shot id from destockd_search, e.g. shot_057" },
                "name": { "type": "string", "description": "Optional output filename (default: \"<film> - <shot>.mp4\")" }
            },
            "required": ["film", "shot"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let film = args
                .get("film")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("film is required")?
                .to_string();
            let shot = args
                .get("shot")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or("shot is required")?
                .to_string();
            let name = args.get("name").and_then(|v| v.as_str());

            let root = session_root(&session)?;
            let saved = destockd::download(&root, &film, &shot, name, false).await?;
            Ok(json!({
                "relPath": saved.rel_path,
                "filename": saved.filename,
                "sizeBytes": saved.size_bytes,
                "clip": saved.clip,
                "pageUrl": saved.page_url,
                "archiveUrl": saved.archive_url,
                "nationalArchivesUrl": saved.national_archives_url,
                "attributionFile": saved.attribution_file,
                "rights": saved.rights,
            }))
        })
    }
}
