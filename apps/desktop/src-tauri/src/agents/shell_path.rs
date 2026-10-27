use std::path::{Path, PathBuf};

pub const MARKER_START: &str = "__LIOS_PATH_START__";
pub const MARKER_END: &str = "__LIOS_PATH_END__";

/// The PATH printed between the markers; rc files may print anything around it.
pub fn parse_marked_path(output: &str) -> Option<String> {
    let start = output.rfind(MARKER_START)? + MARKER_START.len();
    let len = output[start..].find(MARKER_END)?;
    Some(output[start..start + len].to_string())
}

/// Where agents commonly live when the login shell can't tell us.
pub fn fallback_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin"].iter().map(|d| home.join(d)).collect();
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].iter().map(PathBuf::from));
    dirs
}

pub fn merge_path(shell: Option<&str>, fallback: &[PathBuf]) -> String {
    let mut out: Vec<String> = vec![];
    let entries = shell.unwrap_or("").split(':').map(str::to_string).chain(fallback.iter().map(|p| p.to_string_lossy().into_owned()));
    for e in entries {
        if !e.is_empty() && !out.contains(&e) {
            out.push(e);
        }
    }
    out.join(":")
}

static LOGIN_PATH: tokio::sync::Mutex<Option<String>> = tokio::sync::Mutex::const_new(None);

/// The login shell's PATH (GUI apps on macOS don't inherit it), merged with common install dirs. Cached.
pub async fn login_path() -> String {
    let mut cached = LOGIN_PATH.lock().await;
    if let Some(p) = cached.as_ref() {
        return p.clone();
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let script = format!("printf '%s%s%s' '{MARKER_START}' \"$PATH\" '{MARKER_END}'");
    let run = tokio::process::Command::new(shell)
        .args(["-l", "-i", "-c", &script])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let shell_path = match tokio::time::timeout(std::time::Duration::from_secs(5), run).await {
        Ok(Ok(out)) => parse_marked_path(&String::from_utf8_lossy(&out.stdout)),
        _ => None,
    };
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let merged = merge_path(shell_path.as_deref(), &fallback_dirs(&home));
    *cached = Some(merged.clone());
    merged
}

/// Forgets the cached PATH so the next scan asks the shell again.
pub async fn invalidate() {
    *LOGIN_PATH.lock().await = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_marked_path_ignores_rc_noise() {
        let out = format!("Welcome!\n{MARKER_START}/a:/b{MARKER_END}\nbye");
        assert_eq!(parse_marked_path(&out).as_deref(), Some("/a:/b"));
        assert_eq!(parse_marked_path("no markers here"), None);
        let twice = format!("{MARKER_START}/old{MARKER_END} {MARKER_START}/new{MARKER_END}");
        assert_eq!(parse_marked_path(&twice).as_deref(), Some("/new"));
    }

    #[test]
    fn merge_path_dedupes_and_appends_fallbacks() {
        let fallback = vec![PathBuf::from("/b"), PathBuf::from("/c")];
        assert_eq!(merge_path(Some("/a:/b::/a"), &fallback), "/a:/b:/c");
        assert_eq!(merge_path(None, &fallback), "/b:/c");
    }

    #[test]
    fn fallback_dirs_include_common_install_locations() {
        let dirs = fallback_dirs(Path::new("/Users/me"));
        assert!(dirs.contains(&PathBuf::from("/Users/me/.local/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
    }
}
