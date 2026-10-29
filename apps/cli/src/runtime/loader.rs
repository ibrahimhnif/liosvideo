#![allow(clippy::result_large_err)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use deno_core::error::{CoreError, ModuleLoaderError};
use deno_core::url::Url;
use deno_core::{
    FastString, JsRuntime, ModuleLoader, ModuleLoadResponse, ModuleSource,
    ModuleSourceCode, ModuleSpecifier, ModuleType, RequestedModuleType, ResolutionKind,
};
use deno_error::JsErrorBox;

pub const LIOSVIDEO_IIFE: &str = include_str!("liosvideo.iife.js");
pub const THREE_BUNDLE: &str = include_str!("three.bundle.js");

pub const LIOSVIDEO_ESM: &str = r#"
export const {
  BASE_DEFAULTS,    ChromeNode,        ChromeOmnibox,
  CircleNode,       CursorNode,        DesktopNode,
  EditorNode,       GroupNode,         IDENTITY,
  ImageNode,        Node,              PathNode,
  PhoneNode,        RectNode,          ShaderNode,
  TerminalNode,     TextNode,          ThreeNode,
  Track,            VideoNode,         VoHelper,
  WindowNode,       apply,             applyTransition,
  buildManifest,    chrome,            circle,
  clampFrame,       collectAssets,     composition,
  cursor,           desktop,           ease,
  editor,           evaluateFrame,     focus,
  formatColor,      group,             image,
  instantiateScene, layoutComposition, lerpColor,
  logoMark,         multiply,          parseColor,
  path,             phone,             rect,
  registerVoTiming, registerVoTimings, scene,
  seededRandom,     setTextMeasurer,   shader,
  terminal,         text,              three,
  tokyoNightColors, transition,        video,
  vo,               windowNode
} = globalThis.__liosvideo;
export default globalThis.__liosvideo;
"#;

#[derive(Clone)]
pub struct TsModuleLoader {
    project_root: PathBuf,
    in_memory_modules: Arc<Mutex<HashMap<ModuleSpecifier, String>>>,
}

impl TsModuleLoader {
    pub fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
            in_memory_modules: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register_in_memory(&self, specifier: &str, source: &str) -> ModuleSpecifier {
        let url = if let Ok(u) = Url::parse(specifier) {
            u
        } else {
            Url::parse(&format!("memory:///{}", specifier.trim_start_matches('/'))).unwrap()
        };
        self.in_memory_modules
            .lock()
            .unwrap()
            .insert(url.clone(), source.to_string());
        url
    }

    pub fn inject_liosvideo_runtime(&self, runtime: &mut JsRuntime) -> Result<(), CoreError> {
        runtime.execute_script("liosvideo.iife.js", LIOSVIDEO_IIFE)?;
        Ok(())
    }

    pub fn resolve_entry(&self, entry_file: &str) -> Result<ModuleSpecifier, ModuleLoaderError> {
        // If it's already a URL
        if let Ok(url) = Url::parse(entry_file) {
            if url.scheme() == "file" || url.scheme() == "memory" {
                return Ok(url);
            }
        }

        // Check if in-memory has this name
        let memory_candidate = Url::parse(&format!("memory:///{}", entry_file.trim_start_matches('/'))).ok();
        if let Some(ref mem_url) = memory_candidate {
            if self.in_memory_modules.lock().unwrap().contains_key(mem_url) {
                return Ok(mem_url.clone());
            }
        }

        let path = if PathBuf::from(entry_file).is_absolute() {
            PathBuf::from(entry_file)
        } else {
            self.project_root.join(entry_file)
        };

        if path.is_file() {
            return Url::from_file_path(&path).map_err(|_| {
                ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(format!(
                    "Failed to convert path to URL: {}",
                    path.display()
                ))))
            });
        }

        let with_ts = path.with_extension("ts");
        if with_ts.is_file() {
            return Url::from_file_path(&with_ts).map_err(|_| {
                ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(format!(
                    "Failed to convert path to URL: {}",
                    with_ts.display()
                ))))
            });
        }

        let index_ts = path.join("index.ts");
        if index_ts.is_file() {
            return Url::from_file_path(&index_ts).map_err(|_| {
                ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(format!(
                    "Failed to convert path to URL: {}",
                    index_ts.display()
                ))))
            });
        }

        Url::from_file_path(&path).map_err(|_| {
            ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(format!(
                "Failed to convert path to URL: {}",
                path.display()
            ))))
        })
    }

    fn transpile_source(
        &self,
        specifier: &ModuleSpecifier,
        source: &str,
    ) -> Result<ModuleSource, ModuleLoaderError> {
        let parsed = deno_ast::parse_module(deno_ast::ParseParams {
            specifier: specifier.clone(),
            text: source.into(),
            media_type: deno_ast::MediaType::TypeScript,
            capture_tokens: false,
            scope_analysis: false,
            maybe_syntax: None,
        })
        .map_err(|e| {
            ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(e.to_string())))
        })?;

        let transpiled = parsed
            .transpile(
                &deno_ast::TranspileOptions::default(),
                &deno_ast::TranspileModuleOptions::default(),
                &deno_ast::EmitOptions::default(),
            )
            .map_err(|e| {
                ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(e.to_string())))
            })?;

        let js_text = transpiled.into_source().text;
        Ok(ModuleSource::new(
            ModuleType::JavaScript,
            ModuleSourceCode::String(js_text.into()),
            specifier,
            None,
        ))
    }
}

impl ModuleLoader for TsModuleLoader {
    fn resolve(
        &self,
        specifier: &str,
        referrer: &str,
        kind: ResolutionKind,
    ) -> Result<ModuleSpecifier, ModuleLoaderError> {
        if specifier == "liosvideo" || specifier == "liosvideo/gpu" {
            return Ok(ModuleSpecifier::parse("liosvideo://runtime").unwrap());
        }
        if specifier == "three" || specifier.starts_with("three/") {
            return Ok(ModuleSpecifier::parse("liosvideo://three").unwrap());
        }

        if kind == ResolutionKind::MainModule {
            return self.resolve_entry(specifier);
        }

        // Relative resolution
        let base_url = if referrer.is_empty() {
            Url::from_directory_path(&self.project_root).map_err(|_| {
                ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(
                    "Invalid project root path",
                )))
            })?
        } else {
            Url::parse(referrer).map_err(|e| {
                ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(e.to_string())))
            })?
        };

        let joined_url = base_url.join(specifier).map_err(|e| {
            ModuleLoaderError::Core(CoreError::JsBox(JsErrorBox::generic(e.to_string())))
        })?;

        if joined_url.scheme() == "file" {
            if let Ok(file_path) = joined_url.to_file_path() {
                let file_path: PathBuf = file_path;
                if file_path.is_file() {
                    return Ok(joined_url);
                }
                let with_ts = file_path.with_extension("ts");
                if with_ts.is_file() {
                    return Ok(Url::from_file_path(with_ts).unwrap());
                }
                let index_ts = file_path.join("index.ts");
                if index_ts.is_file() {
                    return Ok(Url::from_file_path(index_ts).unwrap());
                }
                let with_js = file_path.with_extension("js");
                if with_js.is_file() {
                    return Ok(Url::from_file_path(with_js).unwrap());
                }
            }
        }

        // Check in-memory store
        {
            let mem = self.in_memory_modules.lock().unwrap();
            if mem.contains_key(&joined_url) {
                return Ok(joined_url);
            }
            if let Ok(with_ts_url) = Url::parse(&format!("{}.ts", joined_url)) {
                if mem.contains_key(&with_ts_url) {
                    return Ok(with_ts_url);
                }
            }
        }

        Ok(joined_url)
    }

    fn load(
        &self,
        module_specifier: &ModuleSpecifier,
        _maybe_referrer: Option<&ModuleSpecifier>,
        _is_dyn_import: bool,
        _requested_module_type: RequestedModuleType,
    ) -> ModuleLoadResponse {
        if module_specifier.scheme() == "liosvideo" {
            let code = match module_specifier.host_str() {
                Some("runtime") | Some("gpu") => LIOSVIDEO_ESM,
                Some("three") => THREE_BUNDLE,
                _ => return ModuleLoadResponse::Sync(Err(ModuleLoaderError::NotFound)),
            };
            return ModuleLoadResponse::Sync(Ok(ModuleSource::new(
                ModuleType::JavaScript,
                ModuleSourceCode::String(FastString::from_static(code)),
                module_specifier,
                None,
            )));
        }

        // In-memory module
        {
            let mem = self.in_memory_modules.lock().unwrap();
            if let Some(source) = mem.get(module_specifier) {
                let res = self.transpile_source(module_specifier, source);
                return ModuleLoadResponse::Sync(res);
            }
        }

        // File system module
        if module_specifier.scheme() == "file" {
            let file_path = match module_specifier.to_file_path() {
                Ok(p) => p,
                Err(_) => return ModuleLoadResponse::Sync(Err(ModuleLoaderError::NotFound)),
            };
            let source = match std::fs::read_to_string(&file_path) {
                Ok(s) => s,
                Err(e) => return ModuleLoadResponse::Sync(Err(e.into())),
            };

            let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "ts" {
                let res = self.transpile_source(module_specifier, &source);
                return ModuleLoadResponse::Sync(res);
            } else if ext == "json" {
                return ModuleLoadResponse::Sync(Ok(ModuleSource::new(
                    ModuleType::Json,
                    ModuleSourceCode::String(source.into()),
                    module_specifier,
                    None,
                )));
            } else {
                return ModuleLoadResponse::Sync(Ok(ModuleSource::new(
                    ModuleType::JavaScript,
                    ModuleSourceCode::String(source.into()),
                    module_specifier,
                    None,
                )));
            }
        }

        ModuleLoadResponse::Sync(Err(ModuleLoaderError::NotFound))
    }
}
