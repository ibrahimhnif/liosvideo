use std::process::Command;

pub struct Keychain;

impl Keychain {
    /// Retrieve a secret by key. Checks environment variables first, then macOS Keychain.
    pub fn get_secret(key: &str) -> Option<String> {
        if let Ok(val) = std::env::var(key) {
            if !val.trim().is_empty() {
                return Some(val);
            }
        }

        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/usr/bin/security")
                .args(["find-generic-password", "-s", "liosvideo", "-a", key, "-w"])
                .output()
                .ok()?;

            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }

        None
    }

    /// Store a secret in the macOS Keychain under the service name "liosvideo".
    pub fn set_secret(key: &str, secret: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/usr/bin/security")
                .args(["add-generic-password", "-U", "-s", "liosvideo", "-a", key, "-w", secret])
                .output()
                .map_err(|e| format!("Failed to invoke macOS keychain: {e}"))?;

            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (key, secret);
            Ok(())
        }
    }

    /// Delete a secret from the macOS Keychain.
    pub fn delete_secret(key: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/usr/bin/security")
                .args(["delete-generic-password", "-s", "liosvideo", "-a", key])
                .output()
                .map_err(|e| format!("Failed to invoke macOS keychain: {e}"))?;

            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = key;
            Ok(())
        }
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
    fn test_keychain_get_secret_returns_none_for_unknown() {
        assert_eq!(Keychain::get_secret("DEFINITELY_UNKNOWN_NONEXISTENT_KEY_9999"), None);
    }
}
