use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

pub struct Keychain;

fn credentials_path() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        let dir = PathBuf::from(home).join(".config").join("liosvideo");
        let _ = std::fs::create_dir_all(&dir);
        Some(dir.join("credentials.json"))
    } else {
        None
    }
}

fn read_credentials_file() -> HashMap<String, String> {
    if let Some(path) = credentials_path() {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                return map;
            }
        }
    }
    HashMap::new()
}

fn write_credentials_file(map: &HashMap<String, String>) -> Result<(), String> {
    if let Some(path) = credentials_path() {
        let content = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&path) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o600); // Only readable & writable by owner
                let _ = std::fs::set_permissions(&path, perms);
            }
        }
        Ok(())
    } else {
        Err("Cannot determine home directory for credentials storage".into())
    }
}

impl Keychain {
    /// Retrieve a secret by key.
    /// Checks:
    /// 1. Environment variables
    /// 2. macOS Keychain
    /// 3. Secure credentials file (~/.config/liosvideo/credentials.json)
    pub fn get_secret(key: &str) -> Option<String> {
        // 1. Environment variable
        if let Ok(val) = std::env::var(key) {
            if !val.trim().is_empty() {
                return Some(val);
            }
        }

        // 2. macOS Keychain
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/usr/bin/security")
                .args(["find-generic-password", "-s", "liosvideo", "-a", key, "-w"])
                .output()
                .ok();

            if let Some(out) = output {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !s.is_empty() {
                        return Some(s);
                    }
                }
            }
        }

        // 3. Fallback to secure credentials file
        let creds = read_credentials_file();
        if let Some(val) = creds.get(key) {
            if !val.trim().is_empty() {
                return Some(val.clone());
            }
        }

        None
    }

    /// Store a secret.
    /// Attempts macOS Keychain first. If Keychain is non-interactive or fails,
    /// falls back gracefully to ~/.config/liosvideo/credentials.json (mode 0600).
    pub fn set_secret(key: &str, secret: &str) -> Result<(), String> {
        let mut keychain_saved = false;

        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/usr/bin/security")
                .args(["add-generic-password", "-U", "-s", "liosvideo", "-a", key, "-w", secret])
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    keychain_saved = true;
                }
            }
        }

        // Always also save to secure credentials file as backup/fallback
        let mut creds = read_credentials_file();
        creds.insert(key.to_string(), secret.to_string());
        write_credentials_file(&creds)?;

        let _ = keychain_saved;
        Ok(())
    }

    /// Delete a secret from Keychain and credentials file.
    pub fn delete_secret(key: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("/usr/bin/security")
                .args(["delete-generic-password", "-s", "liosvideo", "-a", key])
                .output();
        }

        let mut creds = read_credentials_file();
        creds.remove(key);
        write_credentials_file(&creds)?;

        Ok(())
    }
}

#[tauri::command]
pub fn get_api_key(service: String) -> Result<Option<String>, String> {
    Ok(Keychain::get_secret(&service))
}

#[tauri::command]
pub fn set_api_key(service: String, key: String) -> Result<(), String> {
    Keychain::set_secret(&service, &key)
}

#[tauri::command]
pub fn delete_api_key(service: String) -> Result<(), String> {
    Keychain::delete_secret(&service)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keychain_get_secret_from_env() {
        let key = "LIOS_TEST_KEY_123";
        unsafe {
            std::env::set_var(key, "my-super-secret");
        }
        assert_eq!(Keychain::get_secret(key), Some("my-super-secret".into()));
        unsafe {
            std::env::remove_var(key);
        }
    }

    #[test]
    fn test_keychain_fallback_to_credentials_file() {
        let key = "TEST_FALLBACK_KEY";
        let val = "secret-val-999";
        Keychain::set_secret(key, val).unwrap();
        assert_eq!(Keychain::get_secret(key), Some(val.into()));
        Keychain::delete_secret(key).unwrap();
        assert_ne!(Keychain::get_secret(key), Some(val.into()));
    }
}
