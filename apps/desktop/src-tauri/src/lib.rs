mod acp;
mod agents;
pub mod audio;
pub mod export;
mod git;
pub mod keychain;
pub mod mcp;
mod project;
mod recent;
mod scaffold;
mod watch;

/// Lets the frontend write diagnostics to the terminal running `tauri dev`.
#[tauri::command]
fn dev_log(message: String) {
    eprintln!("[webview] {message}");
}

/// Project folder to open at startup (`LIOSVIDEO_PROJECT`), for development.
#[tauri::command]
fn initial_project() -> Option<String> {
    std::env::var("LIOSVIDEO_PROJECT").ok().filter(|p| !p.is_empty())
}

/// Folder for development frame snapshots (`LIOSVIDEO_SNAPSHOT_DIR`).
#[tauri::command]
fn dev_snapshot_dir() -> Option<String> {
    std::env::var("LIOSVIDEO_SNAPSHOT_DIR").ok().filter(|p| !p.is_empty())
}

/// Writes a PNG snapshot into `LIOSVIDEO_SNAPSHOT_DIR` (file name only, no paths).
#[tauri::command]
fn dev_write_snapshot(name: String, bytes: Vec<u8>) -> Result<(), String> {
    let dir = dev_snapshot_dir().ok_or("LIOSVIDEO_SNAPSHOT_DIR is not set")?;
    let file = std::path::Path::new(&name).file_name().ok_or("invalid snapshot name")?;
    std::fs::write(std::path::Path::new(&dir).join(file), bytes).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        .manage(acp::commands::SessionState::default())
        .manage(mcp::render_tools::FrameCaptureCoordinator::default())
        .manage(mcp::asset_tools::AssetRequestCoordinator::default())
        .invoke_handler(tauri::generate_handler![
            dev_log,
            initial_project,
            dev_snapshot_dir,
            dev_write_snapshot,
            mcp::render_tools::report_captured_frame,
            mcp::render_tools::report_timeline_manifest,
            mcp::asset_tools::resolve_asset_request,
            acp::commands::agent_connect,
            acp::commands::agent_authenticate,
            acp::commands::agent_prompt,
            acp::commands::agent_cancel,
            acp::commands::agent_permission_respond,
            acp::commands::agent_set_config_option,
            acp::commands::agent_set_auto_approve,
            acp::commands::agent_get_auto_approve,
            acp::commands::agent_disconnect,
            agents::commands::list_agents,
            agents::commands::rescan_agents,
            agents::commands::install_agent_adapter,
            agents::commands::get_agent_settings,
            agents::commands::set_default_agent,
            agents::commands::set_project_agent,
            agents::commands::add_custom_agent,
            agents::commands::remove_custom_agent,
            project::open_project,
            project::create_project,
            project::recent_projects,
            project::enable_history,
            project::project_history,
            project::commit_diff,
            project::checkpoint,
            project::restore_commit,
            project::list_compositions,
            project::read_project_file,
            project::asset_url_path,
            export::save_exported_video,
            export::save_voice_recording,
            keychain::get_api_key,
            keychain::set_api_key,
            keychain::delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
