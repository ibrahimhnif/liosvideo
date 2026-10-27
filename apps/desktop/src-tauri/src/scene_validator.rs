use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::project::{ProjectError, ProjectState};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneValidationIssue {
    pub severity: String, // "error" | "warning"
    pub message: String,
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneValidationResult {
    pub file: String,
    pub scene_id: Option<String>,
    pub valid: bool,
    pub issues: Vec<SceneValidationIssue>,
}

/// Validate a single scene TypeScript file against liosvideo design & runtime rules.
pub fn validate_scene_content(content: &str, file_rel: &str, project_root: Option<&Path>) -> SceneValidationResult {
    let mut issues = Vec::new();
    let mut scene_id = None;
    let mut scene_duration: Option<f64> = None;

    let lines: Vec<&str> = content.lines().collect();

    // 1. Check for default scene export
    let has_scene_export = content.contains("export default scene(") 
        || content.contains("export default scene (")
        || (content.contains("scene(") && content.contains("export default"));

    if !has_scene_export {
        issues.push(SceneValidationIssue {
            severity: "error".to_string(),
            message: "Scene file must export a default scene using `export default scene(id, config, builder)`.".to_string(),
            line: None,
        });
    }

    // Extract scene ID and duration if present
    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;

        // Try extracting scene ID: scene("id", ...
        if scene_id.is_none() {
            if let Some(pos) = line.find("scene(") {
                let rest = &line[pos + 6..].trim_start();
                if (rest.starts_with('"') || rest.starts_with('\'') || rest.starts_with('`')) && rest.len() > 1 {
                    let quote = rest.chars().next().unwrap();
                    if let Some(end_quote) = rest[1..].find(quote) {
                        let id = &rest[1..1 + end_quote];
                        scene_id = Some(id.to_string());

                        if id.is_empty() {
                            issues.push(SceneValidationIssue {
                                severity: "error".to_string(),
                                message: "Scene ID cannot be empty.".to_string(),
                                line: Some(line_num),
                            });
                        } else if id.contains('/') {
                            issues.push(SceneValidationIssue {
                                severity: "error".to_string(),
                                message: format!("Scene ID \"{id}\" cannot contain '/'. Forward slashes are reserved as hierarchy delimiters."),
                                line: Some(line_num),
                            });
                        }
                    }
                }
            }
        }

        // Try extracting duration: duration: 4.5
        if scene_duration.is_none() {
            if let Some(pos) = line.find("duration:") {
                let rest = line[pos + 9..].trim();
                let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                if let Ok(dur) = num_str.parse::<f64>() {
                    scene_duration = Some(dur);
                    if dur <= 0.0 {
                        issues.push(SceneValidationIssue {
                            severity: "error".to_string(),
                            message: format!("Scene duration ({dur}s) must be greater than 0."),
                            line: Some(line_num),
                        });
                    }
                }
            }
        }

        // 2. Check for non-deterministic calls
        if line.contains("Math.random()") {
            issues.push(SceneValidationIssue {
                severity: "error".to_string(),
                message: "Non-deterministic `Math.random()` detected. Scenes must be purely deterministic; use `random()` provided by the scene builder context.".to_string(),
                line: Some(line_num),
            });
        }
        if line.contains("Date.now()") || line.contains("new Date(") {
            issues.push(SceneValidationIssue {
                severity: "error".to_string(),
                message: "Non-deterministic `Date.now()` or `new Date()` detected. Use scene timeline time/frames instead.".to_string(),
                line: Some(line_num),
            });
        }
        if line.contains("setTimeout(") || line.contains("setInterval(") || line.contains("setImmediate(") {
            issues.push(SceneValidationIssue {
                severity: "error".to_string(),
                message: "Asynchronous timers (`setTimeout`/`setInterval`) are forbidden in deterministic scene builders. Animate properties with `node.to()` or `node.set()`.".to_string(),
                line: Some(line_num),
            });
        }

        // 3. Check for illegal imports
        let trimmed = line.trim();
        if trimmed.starts_with("import ") || trimmed.starts_with("import{") {
            let illegal_nodes = [
                "\"fs\"", "'fs'", "\"fs/promises\"", "'fs/promises'",
                "\"path\"", "'path'", "\"os\"", "'os'", "\"child_process\"", "'child_process'",
                "\"http\"", "'http'", "\"https\"", "'https'", "\"process\"", "'process'",
                "\"node:", "'node:"
            ];
            for node_mod in illegal_nodes {
                if line.contains(node_mod) {
                    issues.push(SceneValidationIssue {
                        severity: "error".to_string(),
                        message: format!("Illegal Node.js module import {node_mod}. Scenes render in WebGPU/browser context and cannot access Node.js standard libraries."),
                        line: Some(line_num),
                    });
                }
            }

            // Check if import is from external npm package (not relative and not liosvideo)
            if let Some(from_pos) = line.find("from") {
                let spec = line[from_pos + 4..].trim().trim_matches(';').trim();
                if (spec.starts_with('"') && spec.ends_with('"')) || (spec.starts_with('\'') && spec.ends_with('\'')) {
                    let pkg = &spec[1..spec.len() - 1];
                    if !pkg.starts_with('.') && !pkg.starts_with('/') && pkg != "liosvideo" {
                        issues.push(SceneValidationIssue {
                            severity: "error".to_string(),
                            message: format!("Illegal external package import \"{pkg}\". Scenes may only import from 'liosvideo' or relative project files."),
                            line: Some(line_num),
                        });
                    }
                }
            }
        }

        // 4. Check for node naming rules: name: "..." containing '/'
        if let Some(pos) = line.find("name:") {
            let rest = line[pos + 5..].trim();
            if (rest.starts_with('"') || rest.starts_with('\'')) && rest.len() > 1 {
                let quote = rest.chars().next().unwrap();
                if let Some(end_quote) = rest[1..].find(quote) {
                    let node_name = &rest[1..1 + end_quote];
                    if node_name.contains('/') {
                        issues.push(SceneValidationIssue {
                            severity: "error".to_string(),
                            message: format!("Node name \"{node_name}\" cannot contain '/'. Slashes are reserved as path hierarchy delimiters."),
                            line: Some(line_num),
                        });
                    }
                }
            }
        }

        // 5. Check animation keyframe duration bounds (warning if at > duration)
        if let Some(max_dur) = scene_duration {
            if let Some(pos) = line.find("at:") {
                let rest = line[pos + 3..].trim();
                let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
                if let Ok(at_sec) = num_str.parse::<f64>() {
                    if at_sec > max_dur {
                        issues.push(SceneValidationIssue {
                            severity: "warning".to_string(),
                            message: format!("Keyframe animation timestamp (at: {at_sec}s) starts after scene duration ({max_dur}s)."),
                            line: Some(line_num),
                        });
                    }
                }
            }
        }

        // 6. Check asset reference existence if project_root is provided
        if let Some(root) = project_root {
            for pattern in ["src:", "src ="] {
                if let Some(pos) = line.find(pattern) {
                    let rest = line[pos + pattern.len()..].trim();
                    for quote in ['"', '\''] {
                        if rest.starts_with(quote) {
                            if let Some(end_q) = rest[1..].find(quote) {
                                let asset_path = &rest[1..1 + end_q];
                                if asset_path.starts_with("assets/") {
                                    let full_path = root.join(asset_path);
                                    if !full_path.exists() {
                                        issues.push(SceneValidationIssue {
                                            severity: "warning".to_string(),
                                            message: format!("Referenced asset file \"{asset_path}\" does not exist on disk."),
                                            line: Some(line_num),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let has_errors = issues.iter().any(|i| i.severity == "error");

    SceneValidationResult {
        file: file_rel.to_string(),
        scene_id,
        valid: !has_errors,
        issues,
    }
}

/// Validates all scene files under `scenes/` (or a specific file).
pub fn validate_scenes_in_project(root: &Path, specific_path: Option<&str>) -> Vec<SceneValidationResult> {
    if let Some(rel) = specific_path {
        let full = root.join(rel);
        if let Ok(content) = fs::read_to_string(&full) {
            return vec![validate_scene_content(&content, rel, Some(root))];
        } else {
            return vec![SceneValidationResult {
                file: rel.to_string(),
                scene_id: None,
                valid: false,
                issues: vec![SceneValidationIssue {
                    severity: "error".to_string(),
                    message: format!("Could not read scene file at {}", full.display()),
                    line: None,
                }],
            }];
        }
    }

    let scenes_dir = root.join("scenes");
    if !scenes_dir.is_dir() {
        return vec![];
    }

    let mut results = Vec::new();
    if let Ok(entries) = fs::read_dir(&scenes_dir) {
        let mut paths: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|de| de.path()))
            .filter(|p| {
                p.extension().and_then(|ext| ext.to_str()) == Some("ts")
                    && !p.file_name().and_then(|n| n.to_str()).unwrap_or("").starts_with('.')
            })
            .collect();
        paths.sort();

        for path in paths {
            if let Ok(content) = fs::read_to_string(&path) {
                let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().into_owned();
                results.push(validate_scene_content(&content, &rel, Some(root)));
            }
        }
    }

    results
}

#[tauri::command]
pub fn validate_scenes(
    state: State<'_, ProjectState>,
    path: Option<String>,
) -> Result<Vec<SceneValidationResult>, ProjectError> {
    let root = state.root()?;
    Ok(validate_scenes_in_project(&root, path.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_scene() {
        let code = r##"
import { scene, text } from "liosvideo";

export default scene("intro", { duration: 5.0, background: "#0b0d12" }, ({ root }) => {
  root.add(text({ name: "title", text: "Hello World" }));
});
"##;
        let res = validate_scene_content(code, "scenes/intro.ts", None);
        assert!(res.valid);
        assert_eq!(res.scene_id.as_deref(), Some("intro"));
        assert!(res.issues.is_empty());
    }

    #[test]
    fn test_invalid_math_random() {
        let code = r##"
import { scene } from "liosvideo";
export default scene("intro", { duration: 5.0 }, () => {
  const x = Math.random();
});
"##;
        let res = validate_scene_content(code, "scenes/intro.ts", None);
        assert!(!res.valid);
        assert!(res.issues.iter().any(|i| i.message.contains("Math.random")));
    }

    #[test]
    fn test_illegal_import() {
        let code = r##"
import fs from "fs";
import axios from "axios";
import { scene } from "liosvideo";
export default scene("intro", { duration: 5.0 }, () => {});
"##;
        let res = validate_scene_content(code, "scenes/intro.ts", None);
        assert!(!res.valid);
        assert!(res.issues.iter().any(|i| i.message.contains("Illegal Node.js module import")));
        assert!(res.issues.iter().any(|i| i.message.contains("Illegal external package import")));
    }

    #[test]
    fn test_node_name_with_slash() {
        let code = r##"
import { scene, text } from "liosvideo";
export default scene("intro", { duration: 5.0 }, ({ root }) => {
  root.add(text({ name: "card/title", text: "Invalid" }));
});
"##;
        let res = validate_scene_content(code, "scenes/intro.ts", None);
        assert!(!res.valid);
        assert!(res.issues.iter().any(|i| i.message.contains("cannot contain '/'")));
    }

    #[test]
    fn test_keyframe_exceeds_duration() {
        let code = r##"
import { scene, rect } from "liosvideo";
export default scene("intro", { duration: 3.0 }, ({ root }) => {
  const r = root.add(rect({ name: "box" }));
  r.to({ opacity: 1 }, { at: 6.0, duration: 1.0 });
});
"##;
        let res = validate_scene_content(code, "scenes/intro.ts", None);
        assert!(res.valid); // warning, not error
        assert!(res.issues.iter().any(|i| i.severity == "warning" && i.message.contains("starts after scene duration")));
    }

    #[test]
    fn test_validate_perkenalan_product() {
        let p = Path::new("/Users/hanif/Labs/personal/Perkenalan Product LiosVideo");
        if p.exists() {
            let res = validate_scenes_in_project(p, None);
            println!("Validation for Perkenalan Product: {:?}", res);
            assert!(!res.is_empty());
            for r in &res {
                println!("File: {}, valid: {}, issues: {:?}", r.file, r.valid, r.issues);
            }
        }
    }
}
