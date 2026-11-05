pub mod loader;
pub mod ops;
pub mod shims;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use deno_core::v8;
use deno_core::{JsRuntime, ModuleSpecifier, RuntimeOptions};
use serde::{Deserialize, Serialize};

use crate::assets::ImageAsset;
use loader::TsModuleLoader;

const THREE_HOST_JS: &str = include_str!("three_host.js");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SceneInfo {
    pub id: String,
    pub start_frame: usize,
    pub end_frame: usize,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioClipInfo {
    pub src: String,
    pub start_frame: usize,
    pub end_frame: usize,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub start_offset: Option<f64>,
    #[serde(default)]
    pub volume: Option<f64>,
    #[serde(default)]
    pub ducking: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackInfo {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub clips: Vec<AudioClipInfo>,
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
    pub manifest: serde_json::Value,
    pub composition: Option<CompositionInfo>,
    three_host_loaded: bool,
}

impl RuntimeHost {
    pub fn new(project_root: PathBuf) -> Result<Self> {
        let loader = TsModuleLoader::new(project_root.clone());
        let mut js_runtime = JsRuntime::new(RuntimeOptions {
            module_loader: Some(Rc::new(loader.clone())),
            extensions: vec![ops::liosvideo_text::init_ops()],
            ..Default::default()
        });

        // Inject DOM / browser environment shims
        shims::inject_shims(&mut js_runtime)
            .map_err(|e| anyhow!("Failed to inject browser shims: {e}"))?;

        // Inject liosvideo runtime library
        loader
            .inject_liosvideo_runtime(&mut js_runtime)
            .map_err(|e| anyhow!("Failed to inject liosvideo runtime: {e}"))?;

        // Register the Rust text measurer (desktop registers Canvas2D `measureText`).
        js_runtime
            .execute_script(
                "install_text_measurer.js",
                r#"(() => {
                    const rt = globalThis.__liosvideo;
                    if (rt && typeof rt.setTextMeasurer === "function") {
                        rt.setTextMeasurer((p) => JSON.parse(Deno.core.ops.op_measure_text(JSON.stringify(p))));
                    }
                })()"#,
            )
            .map_err(|e| anyhow!("Failed to install text measurer: {e}"))?;

        Ok(Self {
            project_root,
            loader,
            js_runtime,
            manifest: serde_json::Value::Null,
            composition: None,
            three_host_loaded: false,
        })
    }

    pub fn register_in_memory_source(&mut self, specifier: &str, source: &str) {
        self.loader.register_in_memory(specifier, source);
    }

    pub fn manifest(&self) -> &serde_json::Value {
        &self.manifest
    }

    /// Collect `assets/audio/vo/*.timing.json` exactly like the desktop host does.
    pub fn vo_timings(&self) -> serde_json::Map<String, serde_json::Value> {
        collect_vo_timings(&self.project_root)
    }

    fn inject_vo_timings(&mut self) -> Result<()> {
        let timings = self.vo_timings();
        if timings.is_empty() {
            return Ok(());
        }
        let json = serde_json::to_string(&timings).context("Failed to serialize VO timings")?;
        let script = format!(
            r#"(() => {{
                globalThis.__liosVoTimings = {json};
                const rt = globalThis.__liosvideo;
                if (rt && typeof rt.registerVoTimings === "function") {{
                    rt.registerVoTimings({json});
                }}
            }})()"#
        );
        self.js_runtime
            .execute_script("inject_vo_timings.js", script)
            .map_err(|e| anyhow!("Failed to inject VO timings: {e}"))?;
        Ok(())
    }

    pub async fn load_composition(&mut self, entry_file: &str) -> Result<CompositionInfo> {
        // Timings must exist before the entry module is evaluated so scenes can size
        // themselves from `vo("line").duration` at module scope.
        self.inject_vo_timings()?;

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

            const rt = globalThis.__liosvideo;
            const layout = rt.layoutComposition(comp);
            const manifest = rt.buildManifest(comp);
            globalThis.__activeComp = comp;
            globalThis.__activeLayout = layout;
            globalThis.__activeManifest = manifest;

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

            const info = {
                width: comp.width,
                height: comp.height,
                fps: comp.fps,
                duration: layout.totalFrames / comp.fps,
                total_frames: layout.totalFrames,
                background: comp.background || "#000000",
                scenes,
                audio: manifest.audioTracks || [],
            };

            return JSON.stringify({ info, manifest });
        })()
        "##;

        let val = self
            .js_runtime
            .execute_script("extract_composition.js", script)
            .map_err(|e| anyhow!("Failed to evaluate composition: {e}"))?;

        let json_str: String = {
            let scope = &mut self.js_runtime.handle_scope();
            let local = v8::Local::new(scope, val);
            deno_core::serde_v8::from_v8(scope, local)
                .context("Failed to deserialize composition JSON string from V8")?
        };

        let payload: serde_json::Value =
            serde_json::from_str(&json_str).context("Failed to parse composition payload")?;
        let info: CompositionInfo = serde_json::from_value(
            payload
                .get("info")
                .cloned()
                .context("Composition payload missing 'info'")?,
        )
        .context("Failed to parse CompositionInfo")?;
        self.manifest = payload
            .get("manifest")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        self.composition = Some(info.clone());

        if manifest_has_three(&self.manifest) && !self.three_host_loaded {
            self.three_host_loaded = true;
            if let Err(error) = self.load_three_host().await {
                eprintln!("Warning: three.js host failed to load: {error:#}");
            }
        }

        Ok(info)
    }

    async fn load_three_host(&mut self) -> Result<()> {
        let specifier = ModuleSpecifier::parse("liosvideo://three-host")
            .map_err(|e| anyhow!("Invalid three host specifier: {e}"))?;
        let module_id = self
            .js_runtime
            .load_side_es_module_from_code(&specifier, THREE_HOST_JS)
            .await
            .map_err(|e| anyhow!("Failed to load three host: {e}"))?;
        let evaluation = self.js_runtime.mod_evaluate(module_id);
        self.js_runtime
            .run_event_loop(Default::default())
            .await
            .map_err(|e| anyhow!("three host event loop failed: {e}"))?;
        evaluation
            .await
            .map_err(|e| anyhow!("three host evaluation failed: {e}"))?;
        Ok(())
    }

    /// Run every `three(...)` node for `frame` and return RGBA frames keyed by node path.
    pub fn render_three_nodes(
        &mut self,
        frame: usize,
        fps: f64,
    ) -> Result<HashMap<String, Arc<ImageAsset>>> {
        let mut frames = HashMap::new();
        if !self.three_host_loaded {
            return Ok(frames);
        }
        let Some(info) = self.composition.clone() else {
            return Ok(frames);
        };
        let (scene_index, time, progress) = scene_clock(&info, frame, fps);

        let script = format!(
            r#"(() => {{
                const host = globalThis.__liosvideoCli;
                if (!host || typeof host.renderThreeScene !== "function") return false;
                const comp = globalThis.__activeComp;
                if (!comp) return false;
                host.renderThreeScene(comp, {scene_index}, {time:.9}, {progress:.9});
                return true;
            }})()"#
        );
        self.js_runtime
            .execute_script("render_three.js", script)
            .map_err(|e| anyhow!("Failed to render three nodes: {e}"))?;

        let op_state = self.js_runtime.op_state();
        let mut state = op_state.borrow_mut();
        let store = state.borrow_mut::<ops::ThreeFrames>();
        for (path, (width, height, rgba)) in std::mem::take(&mut store.0) {
            frames.insert(
                path,
                Arc::new(ImageAsset {
                    width,
                    height,
                    rgba,
                }),
            );
        }
        Ok(frames)
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

        let json_str: String = {
            let scope = &mut self.js_runtime.handle_scope();
            let local = v8::Local::new(scope, val);
            deno_core::serde_v8::from_v8(scope, local)
                .context("Failed to deserialize frame JSON string from V8")?
        };

        let render_list: serde_json::Value =
            serde_json::from_str(&json_str).context("Failed to parse RenderList from JSON")?;

        Ok(render_list)
    }
}

fn manifest_has_three(manifest: &serde_json::Value) -> bool {
    let Some(scenes) = manifest.get("scenes").and_then(|value| value.as_array()) else {
        return false;
    };
    scenes.iter().any(|scene| node_has_three(&scene["tree"]))
}

fn node_has_three(node: &serde_json::Value) -> bool {
    if node.get("kind").and_then(|value| value.as_str()) == Some("three") {
        return true;
    }
    node.get("children")
        .and_then(|value| value.as_array())
        .map(|children| children.iter().any(node_has_three))
        .unwrap_or(false)
}

/// Scene index, scene-relative seconds and 0..1 progress for `frame`.
pub fn scene_clock(info: &CompositionInfo, frame: usize, fps: f64) -> (usize, f32, f32) {
    for (index, scene) in info.scenes.iter().enumerate() {
        if frame >= scene.start_frame && frame < scene.end_frame {
            let time = (frame - scene.start_frame) as f64 / fps.max(0.0001);
            let duration = scene.duration.max(0.0001);
            return (index, time as f32, (time / duration) as f32);
        }
    }
    (0, 0.0, 0.0)
}

pub fn collect_vo_timings(root: &Path) -> serde_json::Map<String, serde_json::Value> {
    let vo_dir = root.join("assets").join("audio").join("vo");
    let mut timings = serde_json::Map::new();

    let Ok(entries) = std::fs::read_dir(&vo_dir) else {
        return timings;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".timing.json") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let line_id = json
            .get("lineId")
            .or_else(|| json.get("line_id"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| name.trim_end_matches(".timing.json").to_string());
        timings.insert(line_id, json);
    }

    timings
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
        assert_eq!(host.manifest()["totalFrames"], 90);

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
    async fn sizes_scenes_from_vo_timings_at_module_scope() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("liosvideo_vo_duration_test_{}", std::process::id()));
        let vo_dir = dir.join("assets").join("audio").join("vo");
        std::fs::create_dir_all(&vo_dir)?;
        std::fs::write(
            vo_dir.join("intro-line-1.timing.json"),
            r#"{"lineId":"intro-line-1","duration":6.0,"words":[]}"#,
        )?;

        let composition_code = r##"
            import { composition, scene, text, vo } from "liosvideo";

            const timing = vo("intro-line-1");
            const intro = scene(
                "intro",
                { duration: Math.max(2.5, timing.duration + 0.6) },
                ({ root }) => { root.add(text({ name: "t", text: "hi" })); },
            );

            export default composition({ width: 640, height: 360, fps: 30, scenes: [intro] });
        "##;
        std::fs::write(dir.join("long.ts"), composition_code)?;

        let mut host = RuntimeHost::new(dir.clone())?;
        let info = host.load_composition("long.ts").await?;

        assert_eq!(info.duration, 6.6);
        assert_eq!(info.total_frames, 198);
        assert_eq!(info.scenes[0].end_frame, 198);

        let _ = std::fs::remove_dir_all(dir);
        Ok(())
    }

    #[tokio::test]
    async fn resolves_relative_scene_imports() -> Result<()> {
        let dir =
            std::env::temp_dir().join(format!("liosvideo_import_test_{}", std::process::id()));
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

    #[tokio::test]
    async fn measures_text_through_the_runtime_measurer() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("liosvideo_text_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;

        let composition_code = r##"
            import { composition, scene, text } from "liosvideo";

            const intro = scene("intro", { duration: 1.0 }, ({ root }) => {
                root.add(text({ name: "title", text: "Hello world", fontSize: 48 }));
            });

            export default composition({
                width: 640,
                height: 360,
                fps: 30,
                scenes: [intro],
            });
        "##;
        std::fs::write(dir.join("text.ts"), composition_code)?;

        let mut host = RuntimeHost::new(dir.clone())?;
        let _ = host.load_composition("text.ts").await?;
        let rl = host.evaluate_frame(0)?;
        let item = &rl["items"][0];
        assert_eq!(item["kind"], "text");
        let matrix = item["matrix"].as_array().expect("matrix");
        // A measured width should shift the anchored text away from x=0.
        assert!(
            matrix.iter().any(|v| v.as_f64().unwrap_or(0.0).abs() > 0.0),
            "text should have a non-zero measured layout matrix"
        );

        let _ = std::fs::remove_dir_all(dir);
        Ok(())
    }

    #[test]
    fn collects_vo_timings_from_assets() {
        let dir = std::env::temp_dir().join(format!("liosvideo_vo_test_{}", std::process::id()));
        let vo = dir.join("assets/audio/vo");
        std::fs::create_dir_all(&vo).unwrap();
        std::fs::write(
            vo.join("intro-1.timing.json"),
            r#"{"lineId":"intro-1","duration":1.2,"words":[{"word":"Halo","start":0.0,"end":0.4}]}"#,
        )
        .unwrap();

        let timings = collect_vo_timings(&dir);
        assert!(timings.contains_key("intro-1"));
        assert_eq!(timings["intro-1"]["duration"], 1.2);

        let _ = std::fs::remove_dir_all(dir);
    }
}
