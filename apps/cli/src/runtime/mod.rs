pub mod loader;
pub mod shims;

use std::path::PathBuf;
use std::rc::Rc;
use anyhow::{anyhow, Context, Result};
use deno_core::v8;
use deno_core::{JsRuntime, RuntimeOptions};
use serde::{Deserialize, Serialize};

use loader::TsModuleLoader;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SceneInfo {
    pub id: String,
    pub start_frame: usize,
    pub end_frame: usize,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioTrackInfo {
    pub id: String,
    #[serde(default)]
    pub src: Option<String>,
    #[serde(default)]
    pub start_at: Option<f64>,
    #[serde(default)]
    pub start_frame: Option<usize>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub volume: Option<f64>,
    #[serde(default)]
    pub loop_track: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CompositionInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub total_frames: usize,
    pub background: String,
    pub scenes: Vec<SceneInfo>,
    #[serde(default)]
    pub audio: Vec<AudioTrackInfo>,
}

pub struct RuntimeHost {
    pub project_root: PathBuf,
    pub loader: TsModuleLoader,
    pub js_runtime: JsRuntime,
}

impl RuntimeHost {
    pub fn new(project_root: PathBuf) -> Result<Self> {
        let loader = TsModuleLoader::new(project_root.clone());
        let mut js_runtime = JsRuntime::new(RuntimeOptions {
            module_loader: Some(Rc::new(loader.clone())),
            ..Default::default()
        });

        // Inject DOM / browser environment shims
        shims::inject_shims(&mut js_runtime)
            .map_err(|e| anyhow!("Failed to inject browser shims: {e}"))?;

        // Inject liosvideo runtime library
        loader
            .inject_liosvideo_runtime(&mut js_runtime)
            .map_err(|e| anyhow!("Failed to inject liosvideo runtime: {e}"))?;

        Ok(Self {
            project_root,
            loader,
            js_runtime,
        })
    }

    pub fn register_in_memory_source(&mut self, specifier: &str, source: &str) {
        self.loader.register_in_memory(specifier, source);
    }

    pub async fn load_composition(&mut self, entry_file: &str) -> Result<CompositionInfo> {
        let specifier = self
            .loader
            .resolve_entry(entry_file)
            .map_err(|e| anyhow!("Failed to resolve entry file '{entry_file}': {e}"))?;

        let mod_id = self
            .js_runtime
            .load_main_es_module(&specifier)
            .await
            .map_err(|e| anyhow!("Failed to load entry module '{specifier}': {e}"))?;

        let eval_fut = self.js_runtime.mod_evaluate(mod_id);
        self.js_runtime
            .run_event_loop(Default::default())
            .await
            .map_err(|e| anyhow!("Error in event loop while evaluating '{specifier}': {e}"))?;
        eval_fut
            .await
            .map_err(|e| anyhow!("Error evaluating module '{specifier}': {e}"))?;

        let namespace = self
            .js_runtime
            .get_module_namespace(mod_id)
            .map_err(|e| anyhow!("Failed to get module namespace for '{specifier}': {e}"))?;

        // Bind namespace to globalThis.__lastModule for evaluation
        {
            let scope = &mut self.js_runtime.handle_scope();
            let ns_local = v8::Local::new(scope, namespace);
            let key = v8::String::new(scope, "__lastModule").unwrap();
            let global = scope.get_current_context().global(scope);
            global.set(scope, key.into(), ns_local.into());
        }

        let script = r##"
        (() => {
            const mod = globalThis.__lastModule;
            const comp = (mod && mod.default) ? mod.default : mod;
            if (!comp) {
                throw new Error("Entry module must export default composition(...)");
            }
            if (typeof comp.width !== "number" || typeof comp.height !== "number" || typeof comp.fps !== "number") {
                throw new Error("Invalid composition: width, height, and fps must be numbers");
            }
            if (!Array.isArray(comp.scenes)) {
                throw new Error("Invalid composition: scenes must be an array");
            }

            const layout = globalThis.__liosvideo.layoutComposition(comp);
            globalThis.__activeComp = comp;
            globalThis.__activeLayout = layout;

            const scenes = layout.scenes.map(s => {
                const orig = comp.scenes.find(o => o.id === s.id);
                const duration = orig && typeof orig.duration === "number"
                    ? orig.duration
                    : (s.endFrame - s.startFrame) / comp.fps;
                return {
                    id: s.id,
                    start_frame: s.startFrame,
                    end_frame: s.endFrame,
                    duration,
                };
            });

            const audio = (comp.audio || []).map(a => ({
                id: a.id || "",
                src: a.src || null,
                start_at: typeof a.startAt === "number" ? a.startAt : null,
                start_frame: typeof a.startFrame === "number" ? a.startFrame : null,
                duration: typeof a.duration === "number" ? a.duration : null,
                volume: typeof a.volume === "number" ? a.volume : null,
                loop_track: typeof a.loop === "boolean" ? a.loop : null,
            }));

            return JSON.stringify({
                width: comp.width,
                height: comp.height,
                fps: comp.fps,
                duration: layout.totalFrames / comp.fps,
                total_frames: layout.totalFrames,
                background: comp.background || "#000000",
                scenes,
                audio,
            });
        })()
        "##;

        let val = self
            .js_runtime
            .execute_script("extract_composition.js", script)
            .map_err(|e| anyhow!("Failed to evaluate composition: {e}"))?;

        let scope = &mut self.js_runtime.handle_scope();
        let local = v8::Local::new(scope, val);
        let json_str: String = deno_core::serde_v8::from_v8(scope, local)
            .context("Failed to deserialize composition JSON string from V8")?;

        let info: CompositionInfo = serde_json::from_str(&json_str)
            .context("Failed to parse CompositionInfo from JSON")?;

        Ok(info)
    }

    pub fn evaluate_frame(&mut self, frame: usize) -> Result<serde_json::Value> {
        let script = format!(
            r##"(() => {{
                if (!globalThis.__activeComp) throw new Error("No active composition loaded");
                const rl = globalThis.__liosvideo.evaluateFrame(globalThis.__activeComp, {});
                return JSON.stringify(rl);
            }})()"##,
            frame
        );

        let val = self
            .js_runtime
            .execute_script("eval_frame.js", script)
            .map_err(|e| anyhow!("Failed to evaluate frame {frame}: {e}"))?;

        let scope = &mut self.js_runtime.handle_scope();
        let local = v8::Local::new(scope, val);
        let json_str: String = deno_core::serde_v8::from_v8(scope, local)
            .context("Failed to deserialize frame JSON string from V8")?;

        let render_list: serde_json::Value = serde_json::from_str(&json_str)
            .context("Failed to parse RenderList from JSON")?;

        Ok(render_list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn loads_typescript_composition_and_evaluates_metadata() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("liosvideo_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;

        let composition_code = r##"
            import { composition, scene, rect } from "liosvideo";

            const intro = scene("intro", { duration: 2.0 }, ({ root, width, height }) => {
                root.add(rect({
                    name: "bg",
                    width,
                    height,
                    fill: "#ff0000",
                }));
            });

            const outro = scene("outro", { duration: 1.0 }, () => {});

            export default composition({
                width: 1920,
                height: 1080,
                fps: 30,
                scenes: [intro, outro],
            });
        "##;

        std::fs::write(dir.join("long.ts"), composition_code)?;

        let mut host = RuntimeHost::new(dir.clone())?;
        let info = host.load_composition("long.ts").await?;

        assert_eq!(info.width, 1920);
        assert_eq!(info.height, 1080);
        assert_eq!(info.fps, 30.0);
        assert_eq!(info.total_frames, 90);
        assert_eq!(info.duration, 3.0);
        assert_eq!(info.scenes.len(), 2);
        assert_eq!(info.scenes[0].id, "intro");
        assert_eq!(info.scenes[0].start_frame, 0);
        assert_eq!(info.scenes[0].end_frame, 60);
        assert_eq!(info.scenes[1].id, "outro");
        assert_eq!(info.scenes[1].start_frame, 60);
        assert_eq!(info.scenes[1].end_frame, 90);

        // Test frame evaluation
        let rl = host.evaluate_frame(0)?;
        assert_eq!(rl["background"], "#000000");
        let items = rl["items"].as_array().expect("items should be an array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["kind"], "rect");
        assert_eq!(items[0]["fill"], "#ff0000");

        let _ = std::fs::remove_dir_all(dir);
        Ok(())
    }

    #[tokio::test]
    async fn resolves_relative_scene_imports() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("liosvideo_import_test_{}", std::process::id()));
        let scenes_dir = dir.join("scenes");
        std::fs::create_dir_all(&scenes_dir)?;

        let scene_code = r##"
            import { scene, circle } from "liosvideo";

            export default scene("hero", { duration: 1.5 }, ({ root }) => {
                root.add(circle({ name: "dot", radius: 50, fill: "#00ff00" }));
            });
        "##;
        std::fs::write(scenes_dir.join("hero.ts"), scene_code)?;

        let comp_code = r##"
            import { composition } from "liosvideo";
            import hero from "./scenes/hero";

            export default composition({
                width: 1080,
                height: 1920,
                fps: 60,
                scenes: [hero],
            });
        "##;
        std::fs::write(dir.join("short.ts"), comp_code)?;

        let mut host = RuntimeHost::new(dir.clone())?;
        let info = host.load_composition("short.ts").await?;

        assert_eq!(info.width, 1080);
        assert_eq!(info.height, 1920);
        assert_eq!(info.fps, 60.0);
        assert_eq!(info.total_frames, 90);
        assert_eq!(info.scenes.len(), 1);
        assert_eq!(info.scenes[0].id, "hero");

        let _ = std::fs::remove_dir_all(dir);
        Ok(())
    }
}
