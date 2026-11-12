// Headless re-implementation of the desktop MCP tools.
//
// The desktop versions of render_frame / get_timeline / request_asset need a webview.
// Here they render server-side (wgpu) and read the manifest from the V8 runtime.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::tools::{Tool, ToolRegistry};
use crate::mcp::tools::BoxFuture;
use crate::pipeline::capture::{inspect_composition, render_png};
use crate::project::{self, git};
use crate::tts::{TtsProvider, UnifiedTtsProvider};

pub struct EditorSession {
    pub project_root: PathBuf,
    pub composition: Option<String>,
    pub selection: Option<Value>,
    pub playhead_frame: usize,
    pub fps: f64,
}

impl EditorSession {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
            composition: None,
            selection: None,
            playhead_frame: 0,
            fps: 30.0,
        }
    }
}

pub type SharedSession = Arc<Mutex<EditorSession>>;

pub fn register_all(registry: &mut ToolRegistry, session: SharedSession) {
    registry.register(Arc::new(GetProjectState {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(SetSelection {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(Seek {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(Checkpoint {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(ValidateScene {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(GetTimeline {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(RenderFrame {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(RenderContactSheet {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(TtsGenerate {
        session: Arc::clone(&session),
    }));
    registry.register(Arc::new(TtsListVoices));
    registry.register(Arc::new(RequestAsset { session: Arc::clone(&session) }));
    crate::mcp::image_tools::register_image_tools(registry, Arc::clone(&session));
    crate::mcp::commons_tools::register_commons_tools(registry, session.clone());
    crate::mcp::sound_tools::register_sound_tools(registry, session.clone());
    crate::mcp::destockd_tools::register_destockd_tools(registry, session);
}

fn session_root(session: &SharedSession) -> Result<PathBuf, String> {
    session
        .lock()
        .map(|s| s.project_root.clone())
        .map_err(|_| "session lock poisoned".to_string())
}

fn resolve_entry(
    session: &SharedSession,
    requested: Option<&str>,
) -> Result<(PathBuf, String), String> {
    let mut guard = session
        .lock()
        .map_err(|_| "session lock poisoned".to_string())?;
    let entry = requested
        .map(str::to_string)
        .or_else(|| guard.composition.clone())
        .or_else(|| {
            project::list_compositions_in(&guard.project_root)
                .ok()
                .and_then(|list| list.into_iter().next())
        })
        .ok_or_else(|| "No composition selected".to_string())?;
    guard.composition = Some(entry.clone());
    Ok((guard.project_root.clone(), entry))
}

fn text(content: &str) -> Value {
    json!({ "type": "text", "text": content })
}

fn image_block(png: &[u8]) -> Value {
    use base64::Engine;
    json!({
        "type": "image",
        "data": base64::engine::general_purpose::STANDARD.encode(png),
        "mimeType": "image/png",
    })
}

struct GetProjectState {
    session: SharedSession,
}

impl Tool for GetProjectState {
    fn name(&self) -> &'static str {
        "get_project_state"
    }

    fn description(&self) -> &'static str {
        "Returns editor context including compositions, selection, errors, and transport state."
    }

    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }

    fn call(&self, _args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let guard = session
                .lock()
                .map_err(|_| "session lock poisoned".to_string())?;
            let root = &guard.project_root;
            let compositions = project::list_compositions_in(root).map_err(|e| e.to_string())?;
            let active = guard
                .composition
                .clone()
                .or_else(|| compositions.first().cloned());
            let project_name = root
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();

            Ok(json!({
                "projectName": project_name,
                "projectRoot": root.to_string_lossy(),
                "compositions": compositions,
                "activeComposition": active,
                "selection": guard.selection,
                "playhead": {
                    "frame": guard.playhead_frame,
                    "fps": guard.fps,
                    "timeSeconds": guard.playhead_frame as f64 / guard.fps.max(1.0),
                },
                "errors": { "compile": [], "runtime": [] },
            }))
        })
    }
}

struct SetSelection {
    session: SharedSession,
}

impl Tool for SetSelection {
    fn name(&self) -> &'static str {
        "set_selection"
    }

    fn description(&self) -> &'static str {
        "Directs the editor UI and timeline selection."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "composition": { "type": "string" },
                "sceneId": { "type": "string" },
                "objectPath": { "type": "string" }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let mut guard = session
                .lock()
                .map_err(|_| "session lock poisoned".to_string())?;
            let composition = args.get("composition").and_then(|v| v.as_str());
            let scene_id = args.get("sceneId").and_then(|v| v.as_str());
            let object_path = args.get("objectPath").and_then(|v| v.as_str());

            if composition.is_none() && scene_id.is_none() && object_path.is_none() {
                guard.selection = None;
            } else {
                guard.selection = Some(json!({
                    "composition": composition,
                    "sceneId": scene_id,
                    "objectPath": object_path,
                }));
                if let Some(c) = composition {
                    guard.composition = Some(c.to_string());
                }
            }

            Ok(json!({ "status": "ok", "selection": guard.selection }))
        })
    }
}

struct Seek {
    session: SharedSession,
}

impl Tool for Seek {
    fn name(&self) -> &'static str {
        "seek"
    }

    fn description(&self) -> &'static str {
        "Moves the transport playhead."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "frame": { "type": "integer", "minimum": 0 },
                "timeSeconds": { "type": "number", "minimum": 0 }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let mut guard = session
                .lock()
                .map_err(|_| "session lock poisoned".to_string())?;
            let fps = guard.fps.max(1.0);
            let frame = args.get("frame").and_then(|v| v.as_u64());
            let time = args.get("timeSeconds").and_then(|v| v.as_f64());

            let resolved = match (frame, time) {
                (Some(f), _) => f as usize,
                (None, Some(t)) => (t * fps).round() as usize,
                (None, None) => {
                    return Err("Either 'frame' or 'timeSeconds' must be provided".to_string())
                }
            };
            guard.playhead_frame = resolved;

            Ok(json!({
                "status": "ok",
                "frame": resolved,
                "timeSeconds": resolved as f64 / fps,
            }))
        })
    }
}

struct Checkpoint {
    session: SharedSession,
}

impl Tool for Checkpoint {
    fn name(&self) -> &'static str {
        "checkpoint"
    }

    fn description(&self) -> &'static str {
        "Forces an immediate git commit."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "message": { "type": "string" } },
            "required": ["message"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let root = session_root(&session)?;
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .filter(|m| !m.trim().is_empty())
                .unwrap_or("Checkpoint")
                .to_string();

            let msg_clone = message.clone();
            let commit = project::git_job(move || git::commit_all(&root, &msg_clone))
                .await
                .map_err(|e| e.to_string())?;

            if let Some(commit) = commit {
                return Ok(json!({ "commitSha": commit.id, "summary": message }));
            }

            let root = session_root(&session)?;
            let commits = project::git_job(move || git::history(&root, 1))
                .await
                .map_err(|e| e.to_string())?;
            commits
                .into_iter()
                .next()
                .map(|c| json!({ "commitSha": c.id, "summary": c.summary }))
                .ok_or_else(|| "No commits in repository and working tree is clean".to_string())
        })
    }
}

struct ValidateScene {
    session: SharedSession,
}

impl Tool for ValidateScene {
    fn name(&self) -> &'static str {
        "validate_scene"
    }

    fn description(&self) -> &'static str {
        "Validates scene TypeScript code against liosvideo deterministic rendering rules, illegal imports, and node naming constraints."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Optional relative path to a scene file (e.g. 'scenes/intro.ts'). If omitted, validates all scenes under scenes/."
                }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let root = session_root(&session)?;
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let scenes =
                project::scene_validator::validate_scenes_in_project(&root, path.as_deref());
            let valid = scenes.iter().all(|s| s.valid);
            Ok(json!({ "valid": valid, "scenes": scenes }))
        })
    }
}

struct GetTimeline {
    session: SharedSession,
}

impl Tool for GetTimeline {
    fn name(&self) -> &'static str {
        "get_timeline"
    }

    fn description(&self) -> &'static str {
        "Returns evaluated timeline manifest (scenes, durations, object tree, audio clips)."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "composition": { "type": "string" } }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let (root, entry) =
                resolve_entry(&session, args.get("composition").and_then(|v| v.as_str()))?;
            let loaded = inspect_composition(root, entry)
                .await
                .map_err(|e| e.to_string())?;
            Ok(loaded.manifest)
        })
    }
}

struct RenderFrame {
    session: SharedSession,
}

impl Tool for RenderFrame {
    fn name(&self) -> &'static str {
        "render_frame"
    }

    fn description(&self) -> &'static str {
        "Renders a frame and returns it as an MCP image content block."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "frame": { "type": "integer", "minimum": 0 },
                "timeSeconds": { "type": "number", "minimum": 0 },
                "composition": { "type": "string" }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let (root, entry) =
                resolve_entry(&session, args.get("composition").and_then(|v| v.as_str()))?;
            let loaded = inspect_composition(root.clone(), entry.clone())
                .await
                .map_err(|e| e.to_string())?;
            let fps = loaded.info.fps.max(1.0);

            let frame = match args.get("frame").and_then(|v| v.as_u64()) {
                Some(f) => f as usize,
                None => match args.get("timeSeconds").and_then(|v| v.as_f64()) {
                    Some(t) => (t * fps).round() as usize,
                    None => session
                        .lock()
                        .map(|s| s.playhead_frame)
                        .map_err(|_| "session lock poisoned".to_string())?,
                },
            };

            let (png, _, _) = render_png(root, entry, frame)
                .await
                .map_err(|e| e.to_string())?;

            Ok(json!({
                "content": [
                    image_block(&png),
                    text(&format!("Frame {frame} ({:.2} s)", frame as f64 / fps)),
                ]
            }))
        })
    }
}

struct RenderContactSheet {
    session: SharedSession,
}

impl Tool for RenderContactSheet {
    fn name(&self) -> &'static str {
        "render_contact_sheet"
    }

    fn description(&self) -> &'static str {
        "Renders multiple frames across a scene or composition as a contact sheet."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sceneId": { "type": "string" },
                "count": { "type": "integer", "minimum": 1, "maximum": 8 },
                "composition": { "type": "string" }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let (root, entry) =
                resolve_entry(&session, args.get("composition").and_then(|v| v.as_str()))?;
            let loaded = inspect_composition(root.clone(), entry.clone())
                .await
                .map_err(|e| e.to_string())?;
            let fps = loaded.info.fps.max(1.0);
            let count = args
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(4)
                .clamp(1, 8) as usize;

            let (start, end) = if let Some(scene_id) = args.get("sceneId").and_then(|v| v.as_str())
            {
                let scenes = loaded
                    .manifest
                    .get("scenes")
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| {
                        "No timeline manifest available to resolve sceneId".to_string()
                    })?;
                let scene = scenes
                    .iter()
                    .find(|s| s.get("id").and_then(|v| v.as_str()) == Some(scene_id))
                    .ok_or_else(|| format!("Scene '{scene_id}' not found"))?;
                (
                    scene
                        .get("startFrame")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as usize,
                    scene.get("endFrame").and_then(|v| v.as_u64()).unwrap_or(1) as usize,
                )
            } else {
                let total = loaded
                    .manifest
                    .get("totalFrames")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(loaded.info.total_frames as u64)
                    as usize;
                (0, total)
            };

            let last = if end > start { end - 1 } else { start };
            let frames: Vec<usize> = if count == 1 {
                vec![start]
            } else {
                (0..count)
                    .map(|i| start + i * (last - start) / (count - 1))
                    .collect()
            };

            let mut content = Vec::new();
            for frame in frames {
                let (png, _, _) = render_png(root.clone(), entry.clone(), frame)
                    .await
                    .map_err(|e| e.to_string())?;
                content.push(image_block(&png));
                content.push(text(&format!(
                    "Frame {frame} ({:.2} s)",
                    frame as f64 / fps
                )));
            }

            Ok(json!({ "content": content }))
        })
    }
}

struct TtsGenerate {
    session: SharedSession,
}

impl Tool for TtsGenerate {
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
                "line_id": { "type": "string", "description": "Identifier for this voiceover line (e.g. 'intro-1', 'step-compile')" },
                "text": { "type": "string", "description": "The exact script text to synthesize" },
                "voice": { "type": "string", "description": "Optional voice ID (e.g. 'mock-neutral', 'mock-narrator')" },
                "force": { "type": "boolean", "description": "Regenerate even when the existing audio has the same text, voice and provider (default false: such lines are reused, not re-billed)" }
            },
            "required": ["line_id", "text"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let root = session_root(&session)?;
            let line_id = args
                .get("line_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "line_id is required".to_string())?
                .to_string();
            let text = args
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "text is required".to_string())?
                .to_string();
            let voice = args
                .get("voice")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            let force = args.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
            let outcome = generate_line(&root, &line_id, &text, voice.as_deref(), force).await?;
            let result = outcome.result;

            Ok(json!({
                "line_id": result.line_id,
                "audio_path": result.audio_rel_path,
                "timing_path": result.timing_rel_path,
                "duration": result.duration,
                "words": result.words,
                "cached": outcome.cached,
                "cost_usd": outcome.cost_usd,
                "stats": outcome.stats,
            }))
        })
    }
}

pub struct LineOutcome {
    pub result: crate::tts::TtsResult,
    pub cached: bool,
    pub cost_usd: f64,
    pub stats: Option<Value>,
}

/// The voice a line is actually spoken with: the requested one or the configured default.
pub fn resolved_voice(voice: Option<&str>, provider: &str) -> String {
    let secret = crate::project::keychain::Keychain::get_secret;
    voice
        .map(str::to_string)
        .or_else(|| secret("DEFAULT_TTS_VOICE"))
        .or_else(|| provider.contains("eleven").then(|| secret("ELEVENLABS_VOICE_ID")).flatten())
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "default".to_string())
}

/// Generates one VO line through the cache; usage is only recorded when the provider was called.
pub async fn generate_line(
    root: &std::path::Path,
    line_id: &str,
    text: &str,
    voice: Option<&str>,
    force: bool,
) -> Result<LineOutcome, String> {
    let label = provider_label(voice);
    let spoken = resolved_voice(voice, label);
    let provider = UnifiedTtsProvider::new();
    let outcome =
        crate::tts::cache::generate_cached(&provider, root, line_id, text, voice, &spoken, label, force).await?;
    let stats = if outcome.cached {
        None
    } else {
        project::record_tts_usage_in(root, line_id, label, voice.unwrap_or(""), text)
            .ok()
            .and_then(|s| serde_json::to_value(s).ok())
    };
    Ok(LineOutcome { result: outcome.result, cached: outcome.cached, cost_usd: outcome.cost_usd, stats })
}

pub fn provider_label(voice: Option<&str>) -> &'static str {
    let Some(voice) = voice else {
        return if crate::project::keychain::Keychain::get_secret("ELEVENLABS_API_KEY").is_some() {
            "elevenlabs"
        } else if crate::project::keychain::Keychain::get_secret("GOOGLE_TTS_API_KEY").is_some()
            || crate::project::keychain::Keychain::get_secret("GOOGLE_API_KEY").is_some()
        {
            "google_cloud"
        } else {
            "mock"
        };
    };

    if voice.starts_with("mock-") {
        "mock"
    } else if voice.starts_with("id-ID-")
        || voice.starts_with("en-US-")
        || voice.starts_with("en-GB-")
    {
        "google_cloud"
    } else if crate::project::keychain::Keychain::get_secret("ELEVENLABS_API_KEY").is_some() {
        "elevenlabs"
    } else {
        "google_cloud"
    }
}

struct TtsListVoices;

impl Tool for TtsListVoices {
    fn name(&self) -> &'static str {
        "tts_list_voices"
    }

    fn description(&self) -> &'static str {
        "Lists available text-to-speech voices and their languages."
    }

    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }

    fn call(&self, _args: Value) -> BoxFuture<Result<Value, String>> {
        Box::pin(async move {
            let voices = UnifiedTtsProvider::new().list_voices();
            Ok(json!({ "voices": voices }))
        })
    }
}

struct RequestAsset {
    session: SharedSession,
}

impl Tool for RequestAsset {
    fn name(&self) -> &'static str {
        "request_asset"
    }

    fn description(&self) -> &'static str {
        "Requests an asset file (image, audio, video, or font) from the user via interactive chat UI."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Unique asset identifier" },
                "kind": { "type": "string", "enum": ["image", "audio", "video", "font"], "description": "Asset category" },
                "description": { "type": "string", "description": "Clear description of the asset needed" }
            },
            "required": ["id", "kind", "description"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let session = Arc::clone(&self.session);
        Box::pin(async move {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "id is required and must not be empty".to_string())?;
            let kind = args.get("kind").and_then(|v| v.as_str()).unwrap_or("image");
            let root = session_root(&session)?;

            // Non-interactive transports answer "skipped" unless a file is supplied via
            // LIOSVIDEO_ASSET_PATH.
            let Some(source) = std::env::var_os("LIOSVIDEO_ASSET_PATH").map(PathBuf::from) else {
                return Ok(json!({ "path": null, "status": "skipped" }));
            };
            if !source.is_file() {
                return Err(format!("Source file does not exist: {}", source.display()));
            }

            let ext = source
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or(match kind {
                    "audio" => "mp3",
                    "video" => "mp4",
                    "font" => "ttf",
                    _ => "png",
                });
            let filename = if id.ends_with(&format!(".{ext}")) {
                id.to_string()
            } else {
                format!("{id}.{ext}")
            };
            let rel = format!("assets/{filename}");
            let target = project::resolve_in_project(&root, &rel).map_err(|e| e.to_string())?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&source, &target).map_err(|e| e.to_string())?;

            Ok(json!({ "path": rel, "status": "provided" }))
        })
    }
}

/// Convenience wrapper for `mcp call <tool>` invocations.
pub async fn call_tool(registry: &ToolRegistry, name: &str, args: Value) -> Result<Value, String> {
    let tool = registry
        .get(name)
        .ok_or_else(|| format!("Unknown tool '{name}'"))?;
    tool.call(args).await
}
