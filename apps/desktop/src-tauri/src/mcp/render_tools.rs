use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::oneshot;

use crate::mcp::state_tools::EditorContext;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

#[derive(Clone, Default)]
pub struct FrameCaptureCoordinator {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
}

impl FrameCaptureCoordinator {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, id: &str) -> oneshot::Receiver<String> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    pub fn remove(&self, id: &str) -> Option<oneshot::Sender<String>> {
        self.pending.lock().unwrap().remove(id)
    }

    pub fn complete(&self, id: &str, data: String) -> bool {
        if let Some(tx) = self.pending.lock().unwrap().remove(id) {
            tx.send(data).is_ok()
        } else {
            false
        }
    }
}

pub fn strip_data_url_prefix(data: &str) -> String {
    if let Some(idx) = data.find(";base64,") {
        data[idx + 8..].trim().to_string()
    } else {
        data.trim().to_string()
    }
}

async fn capture_single_frame(
    context: &EditorContext,
    coordinator: &FrameCaptureCoordinator,
    composition: Option<String>,
    frame: u32,
    timeout_duration: Duration,
) -> Result<(String, f64), String> {
    let fps = context.project_state.playhead().fps.max(1.0);
    let time_seconds = frame as f64 / fps;
    let id = format!(
        "capture-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let rx = coordinator.register(&id);

    let mut payload = json!({
        "id": id,
        "frame": frame,
    });
    if let Some(ref comp) = composition {
        payload["composition"] = json!(comp);
    }

    context.emitter.emit("editor://capture_frame", payload);

    match tokio::time::timeout(timeout_duration, rx).await {
        Ok(Ok(data)) => {
            let clean = strip_data_url_prefix(&data);
            if clean.is_empty() {
                return Err("Webview reported empty frame data".to_string());
            }
            Ok((clean, time_seconds))
        }
        Ok(Err(_)) => {
            coordinator.remove(&id);
            Err("Frame capture channel closed unexpectedly".to_string())
        }
        Err(_) => {
            coordinator.remove(&id);
            Err(format!(
                "Frame capture timed out after {} seconds",
                timeout_duration.as_secs()
            ))
        }
    }
}

pub struct GetTimelineTool {
    context: Arc<EditorContext>,
}

impl GetTimelineTool {
    pub fn new(context: Arc<EditorContext>) -> Self {
        Self { context }
    }
}

impl Tool for GetTimelineTool {
    fn name(&self) -> &'static str {
        "get_timeline"
    }

    fn description(&self) -> &'static str {
        "Returns evaluated timeline manifest (scenes, durations, object tree, audio clips)."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "composition": { "type": "string" }
            }
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let comp_arg = args.get("composition").and_then(|v| v.as_str());
            match context.project_state.manifest(comp_arg) {
                Some(manifest) => Ok(manifest),
                None => match comp_arg {
                    Some(c) => Err(format!("No timeline manifest available for composition '{c}'")),
                    None => Err("No timeline manifest available".to_string()),
                },
            }
        })
    }
}

pub struct RenderFrameTool {
    context: Arc<EditorContext>,
    coordinator: Arc<FrameCaptureCoordinator>,
    timeout: Option<Duration>,
}

impl RenderFrameTool {
    pub fn new(context: Arc<EditorContext>, coordinator: Arc<FrameCaptureCoordinator>) -> Self {
        Self {
            context,
            coordinator,
            timeout: Some(Duration::from_secs(5)),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }
}

impl Tool for RenderFrameTool {
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
        let context = Arc::clone(&self.context);
        let coordinator = Arc::clone(&self.coordinator);
        let timeout = self.timeout.unwrap_or(Duration::from_secs(5));
        Box::pin(async move {
            let comp_arg = args
                .get("composition")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let fps = context.project_state.playhead().fps.max(1.0);
            let frame = if let Some(f) = args.get("frame").and_then(|v| v.as_u64()) {
                f as u32
            } else if let Some(t) = args.get("timeSeconds").and_then(|v| v.as_f64()) {
                (t * fps).round() as u32
            } else {
                context.project_state.playhead().frame
            };

            let (clean_data, time_seconds) =
                capture_single_frame(&context, &coordinator, comp_arg, frame, timeout).await?;
            let text = format!("Frame {} ({:.2} s)", frame, time_seconds);

            Ok(json!({
                "content": [
                    {
                        "type": "image",
                        "data": clean_data,
                        "mimeType": "image/png"
                    },
                    {
                        "type": "text",
                        "text": text
                    }
                ]
            }))
        })
    }
}

pub struct RenderContactSheetTool {
    context: Arc<EditorContext>,
    coordinator: Arc<FrameCaptureCoordinator>,
    timeout: Option<Duration>,
}

impl RenderContactSheetTool {
    pub fn new(context: Arc<EditorContext>, coordinator: Arc<FrameCaptureCoordinator>) -> Self {
        Self {
            context,
            coordinator,
            timeout: Some(Duration::from_secs(5)),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }
}

impl Tool for RenderContactSheetTool {
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
        let context = Arc::clone(&self.context);
        let coordinator = Arc::clone(&self.coordinator);
        let timeout = self.timeout.unwrap_or(Duration::from_secs(5));
        Box::pin(async move {
            let count = args
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(4)
                .clamp(1, 8) as usize;
            let comp_arg = args
                .get("composition")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let scene_id = args.get("sceneId").and_then(|v| v.as_str());

            let manifest = context.project_state.manifest(comp_arg.as_deref());

            let (start_frame, end_frame) = if let Some(sid) = scene_id {
                let m = manifest
                    .ok_or_else(|| "No timeline manifest available to resolve sceneId".to_string())?;
                let scenes = m
                    .get("scenes")
                    .and_then(|s| s.as_array())
                    .ok_or_else(|| "Manifest scenes array missing".to_string())?;
                let scene = scenes
                    .iter()
                    .find(|s| s.get("id").and_then(|id| id.as_str()) == Some(sid))
                    .ok_or_else(|| format!("Scene '{sid}' not found"))?;
                let start = scene.get("startFrame").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let end = scene
                    .get("endFrame")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(start as u64) as u32;
                (start, end)
            } else if let Some(ref m) = manifest {
                let total = m.get("totalFrames").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                (0, total)
            } else {
                (0, 1)
            };

            let last_frame = if end_frame > start_frame {
                end_frame - 1
            } else {
                start_frame
            };
            let frames: Vec<u32> = if count == 1 {
                vec![start_frame]
            } else {
                (0..count)
                    .map(|i| {
                        start_frame
                            + ((i as u64 * (last_frame - start_frame) as u64) / (count as u64 - 1))
                                as u32
                    })
                    .collect()
            };

            let mut content_blocks = Vec::new();
            for f in frames {
                let (data, time_seconds) =
                    capture_single_frame(&context, &coordinator, comp_arg.clone(), f, timeout)
                        .await?;
                content_blocks.push(json!({
                    "type": "image",
                    "data": data,
                    "mimeType": "image/png"
                }));
                content_blocks.push(json!({
                    "type": "text",
                    "text": format!("Frame {} ({:.2} s)", f, time_seconds)
                }));
            }

            Ok(json!({ "content": content_blocks }))
        })
    }
}

pub fn register_render_tools(
    registry: &mut ToolRegistry,
    context: Arc<EditorContext>,
    coordinator: Arc<FrameCaptureCoordinator>,
) {
    registry.register(Arc::new(GetTimelineTool::new(context.clone())));
    registry.register(Arc::new(RenderFrameTool::new(
        context.clone(),
        coordinator.clone(),
    )));
    registry.register(Arc::new(RenderContactSheetTool::new(context, coordinator)));
}

#[tauri::command]
pub fn report_captured_frame(
    coordinator: tauri::State<'_, FrameCaptureCoordinator>,
    id: String,
    data: String,
) -> Result<(), String> {
    coordinator.complete(&id, data);
    Ok(())
}

#[tauri::command]
pub fn report_timeline_manifest(
    project: tauri::State<'_, crate::project::ProjectState>,
    composition: String,
    manifest: serde_json::Value,
) -> Result<(), String> {
    project.set_manifest(composition, manifest);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use crate::mcp::state_tools::EventEmitter;
    use crate::project::ProjectState;

    struct MockCaptureEmitter {
        events: Arc<Mutex<Vec<(String, Value)>>>,
        coordinator: Arc<FrameCaptureCoordinator>,
        auto_respond: Arc<AtomicBool>,
        respond_data: Arc<Mutex<String>>,
    }

    impl MockCaptureEmitter {
        fn new(coordinator: Arc<FrameCaptureCoordinator>) -> Self {
            Self {
                events: Arc::new(Mutex::new(Vec::new())),
                coordinator,
                auto_respond: Arc::new(AtomicBool::new(true)),
                respond_data: Arc::new(Mutex::new(
                    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                        .to_string(),
                )),
            }
        }
    }

    impl EventEmitter for MockCaptureEmitter {
        fn emit(&self, event: &str, payload: Value) {
            self.events.lock().unwrap().push((event.to_string(), payload.clone()));
            if event == "editor://capture_frame" && self.auto_respond.load(Ordering::SeqCst) {
                if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
                    let data = self.respond_data.lock().unwrap().clone();
                    self.coordinator.complete(id, data);
                }
            }
        }
    }

    #[tokio::test]
    async fn test_render_frame_success() {
        let coordinator = Arc::new(FrameCaptureCoordinator::new());
        let emitter = Arc::new(MockCaptureEmitter::new(coordinator.clone()));
        let project_state = ProjectState::default();
        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));

        let tool = RenderFrameTool::new(context, coordinator);
        let res = tool.call(json!({ "frame": 10 })).await.unwrap();

        let content = res.get("content").and_then(|v| v.as_array()).expect("content array");
        let image = &content[0];
        assert_eq!(image["type"], "image");
        assert_eq!(image["mimeType"], "image/png");
        assert_eq!(
            image["data"],
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        );

        let text = &content[1];
        assert_eq!(text["type"], "text");
        assert!(text["text"].as_str().unwrap().contains("Frame 10"));

        // Verify event was emitted
        let events = emitter.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "editor://capture_frame");
        assert_eq!(events[0].1["frame"], 10);
    }

    #[tokio::test]
    async fn test_render_frame_timeout() {
        tokio::time::pause();

        let coordinator = Arc::new(FrameCaptureCoordinator::new());
        let emitter = Arc::new(MockCaptureEmitter::new(coordinator.clone()));
        emitter.auto_respond.store(false, Ordering::SeqCst);

        let project_state = ProjectState::default();
        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));

        let tool = RenderFrameTool::new(context, coordinator);
        let fut = tool.call(json!({ "frame": 10 }));

        tokio::spawn(async {
            tokio::time::advance(Duration::from_secs(6)).await;
        });

        let res = fut.await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("timed out"));
    }

    #[tokio::test]
    async fn test_get_timeline() {
        let project_state = ProjectState::default();
        let manifest_json = json!({
            "width": 1920,
            "height": 1080,
            "fps": 30.0,
            "totalFrames": 120,
            "scenes": [
                {
                    "id": "scene-intro",
                    "startFrame": 0,
                    "endFrame": 60,
                    "tree": { "path": "intro", "children": [] }
                },
                {
                    "id": "scene-outro",
                    "startFrame": 60,
                    "endFrame": 120,
                    "tree": { "path": "outro", "children": [] }
                }
            ]
        });
        project_state.set_manifest("main.ts".to_string(), manifest_json.clone());
        project_state.set_active_composition(Some("main.ts".to_string()));

        let emitter = Arc::new(MockCaptureEmitter::new(Arc::new(FrameCaptureCoordinator::new())));
        let context = Arc::new(EditorContext::new(project_state, emitter));

        let tool = GetTimelineTool::new(context);
        // Call with composition specified
        let res1 = tool.call(json!({ "composition": "main.ts" })).await.unwrap();
        assert_eq!(res1["width"], 1920);
        assert_eq!(res1["scenes"].as_array().unwrap().len(), 2);

        // Call without composition (defaults to active composition)
        let res2 = tool.call(json!({})).await.unwrap();
        assert_eq!(res2["width"], 1920);

        // Call with unknown composition
        let res3 = tool.call(json!({ "composition": "unknown.ts" })).await;
        assert!(res3.is_err());
    }

    #[tokio::test]
    async fn test_render_contact_sheet() {
        let coordinator = Arc::new(FrameCaptureCoordinator::new());
        let emitter = Arc::new(MockCaptureEmitter::new(coordinator.clone()));
        let project_state = ProjectState::default();
        let manifest_json = json!({
            "width": 1920,
            "height": 1080,
            "fps": 30.0,
            "totalFrames": 90,
            "scenes": [
                {
                    "id": "scene-1",
                    "startFrame": 0,
                    "endFrame": 90,
                    "tree": { "path": "scene-1", "children": [] }
                }
            ]
        });
        project_state.set_manifest("main.ts".to_string(), manifest_json);
        project_state.set_active_composition(Some("main.ts".to_string()));

        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));
        let tool = RenderContactSheetTool::new(context, coordinator);

        let res = tool
            .call(json!({
                "sceneId": "scene-1",
                "count": 4
            }))
            .await
            .unwrap();

        let content = res["content"].as_array().unwrap();
        // 4 frames => 4 images + 4 texts = 8 blocks
        assert_eq!(content.len(), 8);
        assert_eq!(content[0]["type"], "image");
        assert_eq!(content[1]["type"], "text");
        assert_eq!(content[2]["type"], "image");
        assert_eq!(content[3]["type"], "text");
    }

    #[tokio::test]
    async fn test_register_render_tools() {
        let coordinator = Arc::new(FrameCaptureCoordinator::new());
        let emitter = Arc::new(MockCaptureEmitter::new(coordinator.clone()));
        let project_state = ProjectState::default();
        let context = Arc::new(EditorContext::new(project_state, emitter));

        let mut registry = ToolRegistry::new();
        register_render_tools(&mut registry, context, coordinator);

        assert!(registry.get("get_timeline").is_some());
        assert!(registry.get("render_frame").is_some());
        assert!(registry.get("render_contact_sheet").is_some());
    }
}
