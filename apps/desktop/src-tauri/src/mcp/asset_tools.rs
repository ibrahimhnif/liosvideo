use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::oneshot;

use crate::mcp::state_tools::EditorContext;
use crate::mcp::tools::{BoxFuture, Tool, ToolRegistry};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetResponse {
    Provided(String),
    Skipped,
    Cancelled,
}

#[derive(Clone, Default)]
pub struct AssetRequestCoordinator {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<AssetResponse>>>>,
}

impl AssetRequestCoordinator {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, id: &str) -> oneshot::Receiver<AssetResponse> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    pub fn resolve(&self, id: &str, file_path: Option<String>) -> bool {
        let mut map = self.pending.lock().unwrap();
        if let Some(tx) = map.remove(id) {
            let resp = match file_path {
                Some(p) => AssetResponse::Provided(p),
                None => AssetResponse::Skipped,
            };
            tx.send(resp).is_ok()
        } else {
            false
        }
    }

    pub fn cancel_all(&self) {
        let mut map = self.pending.lock().unwrap();
        for (_, tx) in map.drain() {
            let _ = tx.send(AssetResponse::Cancelled);
        }
    }

    pub fn on_turn_end(&self) {
        self.cancel_all();
    }
}

#[tauri::command]
pub async fn resolve_asset_request(
    coordinator: tauri::State<'_, AssetRequestCoordinator>,
    request_id: String,
    file_path: Option<String>,
) -> Result<(), String> {
    if coordinator.resolve(&request_id, file_path) {
        Ok(())
    } else {
        Err(format!("No pending asset request with id '{request_id}'"))
    }
}

pub struct RequestAssetTool {
    context: Arc<EditorContext>,
    coordinator: Arc<AssetRequestCoordinator>,
}

impl RequestAssetTool {
    pub fn new(context: Arc<EditorContext>, coordinator: Arc<AssetRequestCoordinator>) -> Self {
        Self {
            context,
            coordinator,
        }
    }
}

impl Tool for RequestAssetTool {
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
                "id": {
                    "type": "string",
                    "description": "Unique asset identifier"
                },
                "kind": {
                    "type": "string",
                    "enum": ["image", "audio", "video", "font"],
                    "description": "Asset category"
                },
                "description": {
                    "type": "string",
                    "description": "Clear description of the asset needed"
                }
            },
            "required": ["id", "kind", "description"]
        })
    }

    fn call(&self, args: Value) -> BoxFuture<Result<Value, String>> {
        let context = self.context.clone();
        let coordinator = self.coordinator.clone();

        Box::pin(async move {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "id is required and must not be empty".to_string())?
                .to_string();

            let kind = args
                .get("kind")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "kind is required and must not be empty".to_string())?
                .to_string();

            let description = args
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "description is required and must not be empty".to_string())?
                .to_string();

            let request_id = format!(
                "req-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );

            let rx = coordinator.register(&request_id);

            context.emitter.emit(
                "agent://asset_request",
                json!({
                    "requestId": request_id,
                    "id": id,
                    "kind": kind,
                    "description": description
                }),
            );

            let response = match rx.await {
                Ok(resp) => resp,
                Err(_) => AssetResponse::Cancelled,
            };

            match response {
                AssetResponse::Cancelled => Ok(json!({
                    "path": Value::Null,
                    "status": "cancelled"
                })),
                AssetResponse::Skipped => Ok(json!({
                    "path": Value::Null,
                    "status": "skipped"
                })),
                AssetResponse::Provided(src_path_str) => {
                    let root = context.project_state.root().map_err(|e| e.to_string())?;
                    let src_path = PathBuf::from(&src_path_str);
                    if !src_path.exists() {
                        return Err(format!("Source file does not exist: {}", src_path.display()));
                    }

                    let ext = src_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .trim();

                    let filename = if ext.is_empty() || id.ends_with(&format!(".{ext}")) {
                        id.clone()
                    } else {
                        format!("{}.{}", id, ext)
                    };

                    let rel_path = format!("assets/{}", filename);
                    let target_path = crate::project::resolve_in_project(&root, &rel_path)
                        .map_err(|e| format!("Invalid target asset path: {e}"))?;

                    if let Some(parent) = target_path.parent() {
                        tokio::fs::create_dir_all(parent)
                            .await
                            .map_err(|e| format!("Failed to create assets directory: {e}"))?;
                    }

                    tokio::fs::copy(&src_path, &target_path)
                        .await
                        .map_err(|e| format!("Failed to copy asset file from '{}': {e}", src_path.display()))?;

                    Ok(json!({
                        "path": rel_path,
                        "status": "provided"
                    }))
                }
            }
        })
    }
}

pub fn register_asset_tools(
    registry: &mut ToolRegistry,
    context: Arc<EditorContext>,
    coordinator: Arc<AssetRequestCoordinator>,
) {
    registry.register(Arc::new(RequestAssetTool::new(context, coordinator)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::state_tools::MockEventEmitter;
    use crate::project::ProjectState;
    use tempfile::tempdir;

    #[tokio::test]
    async fn request_asset_resolves_when_user_provides_file() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("main.ts"), "export default {};").unwrap();

        // Create an outside source file
        let src_file = dir.path().join("source_logo.png");
        std::fs::write(&src_file, b"fake png bytes").unwrap();

        let coordinator = Arc::new(AssetRequestCoordinator::new());
        let emitter = Arc::new(MockEventEmitter::new());
        let project_state = ProjectState::default();
        project_state.open_for_test(project_dir.clone());

        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));
        let tool = RequestAssetTool::new(context, coordinator.clone());

        let tool_call = tokio::spawn(async move {
            tool.call(json!({
                "id": "logo",
                "kind": "image",
                "description": "App logo image"
            })).await
        });

        // Give the spawned task a moment to register the request
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "agent://asset_request");
        let req_id = events[0].1["requestId"].as_str().unwrap().to_string();
        assert_eq!(events[0].1["id"], "logo");
        assert_eq!(events[0].1["kind"], "image");

        // User resolves the request with the source file
        assert!(coordinator.resolve(&req_id, Some(src_file.to_str().unwrap().to_string())));

        let res = tool_call.await.unwrap().expect("tool call succeeded");
        assert_eq!(res["status"], "provided");
        assert_eq!(res["path"], "assets/logo.png");

        // Verify the file was copied to the project assets folder
        let copied_path = project_dir.join("assets").join("logo.png");
        assert!(copied_path.exists());
        assert_eq!(std::fs::read(&copied_path).unwrap(), b"fake png bytes");
    }

    #[tokio::test]
    async fn request_asset_cancels_on_turn_end() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("main.ts"), "export default {};").unwrap();

        let coordinator = Arc::new(AssetRequestCoordinator::new());
        let emitter = Arc::new(MockEventEmitter::new());
        let project_state = ProjectState::default();
        project_state.open_for_test(project_dir.clone());

        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));
        let tool = RequestAssetTool::new(context, coordinator.clone());

        let tool_call = tokio::spawn(async move {
            tool.call(json!({
                "id": "bg-music",
                "kind": "audio",
                "description": "Background track"
            })).await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let events = emitter.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "agent://asset_request");

        // Turn ends before user responds
        coordinator.on_turn_end();

        let res = tool_call.await.unwrap().expect("tool call should return cancelled object");
        assert_eq!(res["status"], "cancelled");
        assert!(res["path"].is_null());
    }

    #[tokio::test]
    async fn request_asset_skips_when_user_skips() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("main.ts"), "export default {};").unwrap();

        let coordinator = Arc::new(AssetRequestCoordinator::new());
        let emitter = Arc::new(MockEventEmitter::new());
        let project_state = ProjectState::default();
        project_state.open_for_test(project_dir.clone());

        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));
        let tool = RequestAssetTool::new(context, coordinator.clone());

        let tool_call = tokio::spawn(async move {
            tool.call(json!({
                "id": "optional-icon",
                "kind": "image",
                "description": "Optional icon"
            })).await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let events = emitter.events();
        let req_id = events[0].1["requestId"].as_str().unwrap().to_string();

        assert!(coordinator.resolve(&req_id, None));

        let res = tool_call.await.unwrap().expect("tool call should return skipped object");
        assert_eq!(res["status"], "skipped");
        assert!(res["path"].is_null());
    }

    #[tokio::test]
    async fn request_asset_prevents_directory_traversal() {
        let dir = tempdir().unwrap();
        let project_dir = dir.path().join("proj");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("main.ts"), "export default {};").unwrap();

        let src_file = dir.path().join("test.png");
        std::fs::write(&src_file, b"test").unwrap();

        let coordinator = Arc::new(AssetRequestCoordinator::new());
        let emitter = Arc::new(MockEventEmitter::new());
        let project_state = ProjectState::default();
        project_state.open_for_test(project_dir.clone());

        let context = Arc::new(EditorContext::new(project_state, emitter.clone()));
        let tool = RequestAssetTool::new(context, coordinator.clone());

        let tool_call = tokio::spawn(async move {
            tool.call(json!({
                "id": "../../../escaped",
                "kind": "image",
                "description": "Malicious path attempt"
            })).await
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let events = emitter.events();
        let req_id = events[0].1["requestId"].as_str().unwrap().to_string();

        assert!(coordinator.resolve(&req_id, Some(src_file.to_str().unwrap().to_string())));

        let res = tool_call.await.unwrap();
        assert!(res.is_err(), "Path traversal must be rejected");
    }
}
