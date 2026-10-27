use std::path::PathBuf;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::project::is_ignored;

pub type Watcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

#[derive(Clone, Serialize)]
struct Changed {
    paths: Vec<String>,
}

/// Watches `root` and emits `project://changed` with project-relative paths, debounced 100 ms.
pub fn start(app: AppHandle, root: PathBuf) -> notify::Result<Watcher> {
    let base = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(100), None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut paths: Vec<String> = events
            .iter()
            .flat_map(|e| e.paths.iter())
            .filter_map(|p| p.strip_prefix(&base).ok())
            .map(|p| p.to_string_lossy().into_owned())
            .filter(|p| !p.is_empty() && !is_ignored(p))
            .collect();
        paths.sort();
        paths.dedup();
        if !paths.is_empty() {
            let _ = app.emit("project://changed", Changed { paths });
        }
    })?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
