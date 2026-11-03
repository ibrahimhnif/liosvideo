// Copied from apps/desktop/src-tauri/src/watch.rs.
// The Tauri `AppHandle` emit is replaced with a callback.

use std::path::PathBuf;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

use crate::project::is_ignored;

pub type Watcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Watches `root` and reports project-relative changed paths after `debounce_ms`.
pub fn start<F>(root: PathBuf, debounce_ms: u64, on_change: F) -> notify::Result<Watcher>
where
    F: Fn(Vec<String>) + Send + 'static,
{
    let base = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(debounce_ms),
        None,
        move |res: DebounceEventResult| {
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
                on_change(paths);
            }
        },
    )?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
