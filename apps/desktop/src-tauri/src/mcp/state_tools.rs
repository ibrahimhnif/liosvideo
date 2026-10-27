use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};
use crate::project::{EditorSelection, PlayheadState, ProjectState};

pub trait EventEmitter: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

#[derive(Clone)]
pub struct EditorContext {
    pub project_state: ProjectState,
    pub emitter: Arc<dyn EventEmitter>,
}

impl EditorContext {
    pub fn new(project_state: ProjectState, emitter: Arc<dyn EventEmitter>) -> Self {
        Self {
            project_state,
            emitter,
        }
    }
}

pub struct TauriEventEmitter(pub tauri::AppHandle);

impl TauriEventEmitter {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self(app)
    }
}

impl EventEmitter for TauriEventEmitter {
    fn emit(&self, event: &str, payload: Value) {
        use tauri::Emitter;
        let _ = self.0.emit(event, payload);
    }
}

#[derive(Default, Clone)]
pub struct NoopEventEmitter;

impl EventEmitter for NoopEventEmitter {
    fn emit(&self, _event: &str, _payload: Value) {}
}

#[derive(Default, Clone)]
pub struct MockEventEmitter {
    pub events: Arc<Mutex<Vec<(String, Value)>>>,
}

impl MockEventEmitter {
    pub fn new() -> Self {
        Self {
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn events(&self) -> Vec<(String, Value)> {
        self.events.lock().unwrap().clone()
    }
}

impl EventEmitter for MockEventEmitter {
    fn emit(&self, event: &str, payload: Value) {
        self.events.lock().unwrap().push((event.to_string(), payload));
    }
}

pub struct GetProjectStateTool {
    context: Arc<EditorContext>,
}

impl GetProjectStateTool {
    pub fn new(context: Arc<EditorContext>) -> Self {
        Self { context }
    }
}

impl Tool for GetProjectStateTool {
    fn name(&self) -> &'static str {
        "get_project_state"
    }

    fn description(&self) -> &'static str {
        "Returns editor context including compositions, selection, errors, and transport state."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {}
        })
    }

    fn call(&self, _args: Value) -> BoxFuture<Result<Value, String>> {
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let root = context.project_state.root().map_err(|e| e.to_string())?;
            let project_name = root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Untitled".to_string());
            let project_root = root.to_string_lossy().into_owned();
            let compositions = crate::project::list_compositions_in(&root).map_err(|e| e.to_string())?;
            let active_composition = context
                .project_state
                .active_composition()
                .or_else(|| compositions.first().cloned());
            let selection = context.project_state.selection();
            let playhead = context.project_state.playhead();
            let errors = context.project_state.errors();

            Ok(json!({
                "projectName": project_name,
                "projectRoot": project_root,
                "compositions": compositions,
                "activeComposition": active_composition,
                "selection": selection,
                "playhead": playhead,
                "errors": errors,
            }))
        })
    }
}

pub struct SetSelectionTool {
    context: Arc<EditorContext>,
}

impl SetSelectionTool {
    pub fn new(context: Arc<EditorContext>) -> Self {
        Self { context }
    }
}

impl Tool for SetSelectionTool {
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
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let composition = args.get("composition").and_then(|v| v.as_str()).map(|s| s.to_string());
            let scene_id = args.get("sceneId").and_then(|v| v.as_str()).map(|s| s.to_string());
            let object_path = args.get("objectPath").and_then(|v| v.as_str()).map(|s| s.to_string());

            let selection = if composition.is_none() && scene_id.is_none() && object_path.is_none() {
                None
            } else {
                Some(EditorSelection {
                    composition: composition.clone(),
                    scene_id,
                    object_path,
                })
            };

            if let Some(ref comp) = composition {
                context.project_state.set_active_composition(Some(comp.clone()));
            }
            context.project_state.set_selection(selection.clone());

            let payload = serde_json::to_value(&selection).unwrap_or(Value::Null);
            context.emitter.emit("project://selection", payload);

            Ok(json!({
                "status": "ok",
                "selection": selection,
            }))
        })
    }
}

pub struct SeekTool {
    context: Arc<EditorContext>,
}

impl SeekTool {
    pub fn new(context: Arc<EditorContext>) -> Self {
        Self { context }
    }
}

impl Tool for SeekTool {
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
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let frame_arg = args.get("frame").and_then(|v| v.as_u64()).map(|v| v as u32);
            let time_arg = args.get("timeSeconds").and_then(|v| v.as_f64());

            let fps = context.project_state.playhead().fps.max(1.0);
            let (frame, time_seconds) = match (frame_arg, time_arg) {
                (Some(f), Some(t)) => (f, t),
                (Some(f), None) => (f, f as f64 / fps),
                (None, Some(t)) => ((t * fps).round() as u32, t),
                (None, None) => return Err("Either 'frame' or 'timeSeconds' must be provided".to_string()),
            };

            context.project_state.set_playhead(PlayheadState {
                frame,
                fps,
                time_seconds,
            });

            let payload = json!({
                "frame": frame,
                "timeSeconds": time_seconds,
            });
            context.emitter.emit("preview://seek", payload);

            Ok(json!({
                "status": "ok",
                "frame": frame,
                "timeSeconds": time_seconds,
            }))
        })
    }
}

pub struct CheckpointTool {
    context: Arc<EditorContext>,
}

impl CheckpointTool {
    pub fn new(context: Arc<EditorContext>) -> Self {
        Self { context }
    }
}

impl Tool for CheckpointTool {
    fn name(&self) -> &'static str {
        "checkpoint"
    }

    fn description(&self) -> &'static str {
        "Forces an immediate git commit."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "message": { "type": "string" }
            },
            "required": ["message"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = Arc::clone(&self.context);
        Box::pin(async move {
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Checkpoint")
                .trim()
                .to_string();
            let message = if message.is_empty() { "Checkpoint".to_string() } else { message };

            let root = context.project_state.root().map_err(|e| e.to_string())?;

            let root_clone = root.clone();
            let msg_clone = message.clone();
            let commit_opt = crate::project::git_job(move || {
                crate::git::commit_all(&root_clone, &msg_clone)
            })
            .await
            .map_err(|e| e.to_string())?;

            let commit = match commit_opt {
                Some(c) => {
                    let val = serde_json::to_value(&c).unwrap_or(Value::Null);
                    context.emitter.emit("project://committed", val);
                    c
                }
                None => {
                    let commits = crate::git::history(&root, 1).map_err(|e| e.to_string())?;
                    commits
                        .into_iter()
                        .next()
                        .ok_or_else(|| "No commits in repository and working tree is clean".to_string())?
                }
            };

            Ok(json!({
                "commitSha": commit.id,
                "summary": commit.summary,
            }))
        })
    }
}

pub fn register_state_tools(registry: &mut ToolRegistry, context: Arc<EditorContext>) {
    registry.register(Arc::new(GetProjectStateTool::new(context.clone())));
    registry.register(Arc::new(SetSelectionTool::new(context.clone())));
    registry.register(Arc::new(SeekTool::new(context.clone())));
    registry.register(Arc::new(CheckpointTool::new(context)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_test_project() -> (tempfile::TempDir, Arc<EditorContext>, Arc<MockEventEmitter>) {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("main.ts"), "export default {}").unwrap();
        fs::write(dir.path().join("intro.ts"), "export default {}").unwrap();

        let state = ProjectState::default();
        state.open_for_test(dir.path().to_path_buf());
        let emitter = Arc::new(MockEventEmitter::new());
        let context = Arc::new(EditorContext::new(state, emitter.clone()));
        (dir, context, emitter)
    }

    #[tokio::test]
    async fn test_get_project_state() {
        let (dir, context, _emitter) = setup_test_project();
        let tool = GetProjectStateTool::new(context);
        let res = tool.call(json!({})).await.unwrap();

        let expected_name = dir.path().file_name().unwrap().to_string_lossy();
        assert_eq!(res["projectName"], expected_name.as_ref());
        assert_eq!(res["projectRoot"], dir.path().to_string_lossy().as_ref());
        let comps = res["compositions"].as_array().unwrap();
        assert_eq!(comps.len(), 2);
        assert!(comps.contains(&json!("intro.ts")));
        assert!(comps.contains(&json!("main.ts")));
        assert_eq!(res["activeComposition"], "intro.ts");
        assert!(res["selection"].is_null());
        assert_eq!(res["playhead"]["frame"], 0);
        assert_eq!(res["playhead"]["fps"], 30.0);
        assert_eq!(res["playhead"]["timeSeconds"], 0.0);
        assert!(res["errors"]["compile"].as_array().unwrap().is_empty());
        assert!(res["errors"]["runtime"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_set_selection() {
        let (_dir, context, emitter) = setup_test_project();
        let tool = SetSelectionTool::new(context.clone());

        let res = tool
            .call(json!({
                "composition": "main.ts",
                "sceneId": "scene1",
                "objectPath": "rect"
            }))
            .await
            .unwrap();

        assert_eq!(res["status"], "ok");
        assert_eq!(res["selection"]["composition"], "main.ts");
        assert_eq!(res["selection"]["sceneId"], "scene1");
        assert_eq!(res["selection"]["objectPath"], "rect");

        // Verify editor state updated
        let sel = context.project_state.selection().unwrap();
        assert_eq!(sel.composition.as_deref(), Some("main.ts"));
        assert_eq!(sel.scene_id.as_deref(), Some("scene1"));
        assert_eq!(sel.object_path.as_deref(), Some("rect"));

        // Verify active composition updated
        assert_eq!(context.project_state.active_composition().as_deref(), Some("main.ts"));

        // Verify event emitted
        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "project://selection");
        assert_eq!(events[0].1["sceneId"], "scene1");
        assert_eq!(events[0].1["objectPath"], "rect");
    }

    #[tokio::test]
    async fn test_seek() {
        let (_dir, context, emitter) = setup_test_project();
        let tool = SeekTool::new(context.clone());

        // Seek with frame
        let res1 = tool.call(json!({ "frame": 45 })).await.unwrap();
        assert_eq!(res1["status"], "ok");
        assert_eq!(res1["frame"], 45);
        assert_eq!(res1["timeSeconds"], 1.5); // 45 / 30fps

        assert_eq!(context.project_state.playhead().frame, 45);
        assert_eq!(context.project_state.playhead().time_seconds, 1.5);

        // Seek with timeSeconds
        let res2 = tool.call(json!({ "timeSeconds": 2.0 })).await.unwrap();
        assert_eq!(res2["status"], "ok");
        assert_eq!(res2["frame"], 60); // 2.0 * 30fps
        assert_eq!(res2["timeSeconds"], 2.0);

        assert_eq!(context.project_state.playhead().frame, 60);

        let events = emitter.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, "preview://seek");
        assert_eq!(events[0].1["frame"], 45);
        assert_eq!(events[0].1["timeSeconds"], 1.5);

        assert_eq!(events[1].0, "preview://seek");
        assert_eq!(events[1].1["frame"], 60);
        assert_eq!(events[1].1["timeSeconds"], 2.0);
    }

    #[tokio::test]
    async fn test_checkpoint() {
        let (dir, context, emitter) = setup_test_project();
        crate::git::enable_history(dir.path()).unwrap();

        // Write a change
        fs::write(dir.path().join("file.txt"), "hello").unwrap();

        let tool = CheckpointTool::new(context);
        let res = tool.call(json!({ "message": "test commit" })).await.unwrap();

        assert_eq!(res["summary"], "test commit");
        let commit_sha = res["commitSha"].as_str().unwrap();
        assert!(!commit_sha.is_empty());

        // Verify git commit exists in repo
        let commits = crate::git::history(dir.path(), 5).unwrap();
        assert_eq!(commits[0].id, commit_sha);
        assert_eq!(commits[0].summary, "test commit");

        // Verify event emitted
        let events = emitter.events();
        let committed_event = events.iter().find(|(name, _)| name == "project://committed");
        assert!(committed_event.is_some());
        assert_eq!(committed_event.unwrap().1["id"], commit_sha);
    }

    #[tokio::test]
    async fn test_register_state_tools() {
        let (_dir, context, _emitter) = setup_test_project();
        let mut registry = ToolRegistry::new();
        register_state_tools(&mut registry, context);

        let list = registry.list();
        let names: Vec<&str> = list.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"get_project_state"));
        assert!(names.contains(&"set_selection"));
        assert!(names.contains(&"seek"));
        assert!(names.contains(&"checkpoint"));
    }
}
