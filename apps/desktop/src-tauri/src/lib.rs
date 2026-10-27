mod git;
mod project;
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
        .invoke_handler(tauri::generate_handler![
            dev_log,
            initial_project,
            dev_snapshot_dir,
            dev_write_snapshot,
            project::open_project,
            project::list_compositions,
            project::read_project_file,
            project::asset_url_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
