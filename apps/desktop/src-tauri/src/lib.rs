mod project;
mod watch;

/// Lets the frontend write diagnostics to the terminal running `tauri dev`.
#[tauri::command]
fn dev_log(message: String) {
    eprintln!("[webview] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        .invoke_handler(tauri::generate_handler![
            dev_log,
            project::open_project,
            project::list_compositions,
            project::read_project_file,
            project::asset_url_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
