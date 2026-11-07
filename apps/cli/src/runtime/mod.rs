pub mod loader;
pub mod ops;
pub mod shims;
pub mod webgpu;

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
const THREE_GPU_JS: &str = include_str!("three_gpu.js");

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
    /// "vo" | "music" | "sfx"
    #[serde(default)]
    pub role: Option<String>,
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
    /// The composition's `mix` settings (loudness, ceiling, duck), as written.
    #[serde(default)]
    pub mix: Option<serde_json::Value>,
}

pub struct RuntimeHost {
    pub project_root: PathBuf,
    pub loader: TsModuleLoader,
    pub js_runtime: JsRuntime,
    pub manifest: serde_json::Value,
    pub composition: Option<CompositionInfo>,
    three_host_loaded: bool,
    /// three() nodes render on the GPU (three.js WebGPURenderer) until that proves impossible.
    three_gpu: bool,
}

impl RuntimeHost {
    pub fn new(project_root: PathBuf) -> Result<Self> {
        let loader = TsModuleLoader::new(project_root.clone());
        let mut js_runtime = JsRuntime::new(RuntimeOptions {
            module_loader: Some(Rc::new(loader.clone())),
            extensions: {
                let mut list = vec![ops::liosvideo_text::init_ops()];
                list.extend(webgpu::extensions());
                list
            },
            ..Default::default()
        });

        js_runtime
            .op_state()
            .borrow_mut()
            .put(ops::ProjectRoot(project_root.clone()));

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
            three_gpu: false,
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

    /// Hands `assets/ATTRIBUTIONS.md` to the runtime so `credit({ asset })` can quote its row.
    fn inject_attributions(&mut self) -> Result<()> {
        let path = self.project_root.join("assets").join("ATTRIBUTIONS.md");
        let Ok(markdown) = std::fs::read_to_string(&path) else {
            return Ok(());
        };
        let json = serde_json::to_string(&markdown).context("Failed to serialize attributions")?;
        let script = format!(
            r#"(() => {{
                globalThis.__liosAttributions = {json};
                const rt = globalThis.__liosvideo;
                if (rt && typeof rt.registerAttributions === "function") rt.registerAttributions({json});
            }})()"#
        );
        self.js_runtime
            .execute_script("inject_attributions.js", script)
            .map_err(|e| anyhow!("Failed to inject attributions: {e}"))?;
        Ok(())
    }

    pub async fn load_composition(&mut self, entry_file: &str) -> Result<CompositionInfo> {
        // Timings must exist before the entry module is evaluated so scenes can size
        // themselves from `vo("line").duration` at module scope.
        self.inject_vo_timings()?;
        self.inject_attributions()?;

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
                mix: manifest.mix ?? null,
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

        // LIOSVIDEO_THREE=software keeps the CPU rasteriser (no GPU, or for comparison)
        if std::env::var("LIOSVIDEO_THREE")
            .map(|v| v == "software")
            .unwrap_or(false)
        {
            return Ok(());
        }
        let specifier = ModuleSpecifier::parse("liosvideo://three-gpu-host")
            .map_err(|e| anyhow!("Invalid three GPU host specifier: {e}"))?;
        let loaded = async {
            let module_id = self
                .js_runtime
                .load_side_es_module_from_code(&specifier, THREE_GPU_JS)
                .await?;
            let evaluation = self.js_runtime.mod_evaluate(module_id);
            self.js_runtime.run_event_loop(Default::default()).await?;
            evaluation.await
        }
        .await;
        match loaded {
            Ok(()) => self.three_gpu = true,
            Err(error) => eprintln!("Warning: three.js GPU renderer failed to load, using the software rasteriser: {error}"),
        }
        Ok(())
    }

    /// Run every `three(...)` node for `frame` and return RGBA frames keyed by node path.
    pub async fn render_three_nodes(
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

        if self.three_gpu {
            if self.render_three_gpu(scene_index, time, progress).await? {
                return Ok(self.take_three_frames());
            }
            self.three_gpu = false;
        }

        // setup may be async (gltf / hdr / texture), so it runs before the synchronous render
        let prepare = format!(
            r#"(async () => {{
                const host = globalThis.__liosvideoCli;
                const comp = globalThis.__activeComp;
                if (host && comp && typeof host.prepareThreeScene === "function") {{
                    await host.prepareThreeScene(comp, {scene_index}, {time:.9});
                }}
            }})()"#
        );
        let promise = self
            .js_runtime
            .execute_script("prepare_three.js", prepare)
            .map_err(|e| anyhow!("Failed to set up three nodes: {e}"))?;
        let resolved = self.js_runtime.resolve(promise);
        self.js_runtime
            .with_event_loop_promise(resolved, Default::default())
            .await
            .map_err(|e| anyhow!("Failed to set up three nodes: {e}"))?;

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
        frames.extend(self.take_three_frames());
        Ok(frames)
    }

    /// Renders the scene's three() nodes with three.js WebGPURenderer; false when no GPU can be used.
    async fn render_three_gpu(
        &mut self,
        scene_index: usize,
        time: f32,
        progress: f32,
    ) -> Result<bool> {
        let script = format!(
            r#"(async () => {{
                const host = globalThis.__liosvideoCliGpu;
                const comp = globalThis.__activeComp;
                if (!host || !comp) return false;
                return await host.renderThreeSceneGpu(comp, {scene_index}, {time:.9}, {progress:.9});
            }})()"#
        );
        let promise = self
            .js_runtime
            .execute_script("render_three_gpu.js", script)
            .map_err(|e| anyhow!("Failed to render three nodes on the GPU: {e}"))?;
        let resolved = self.js_runtime.resolve(promise);
        let value = self
            .js_runtime
            .with_event_loop_promise(resolved, Default::default())
            .await
            .map_err(|e| anyhow!("Failed to render three nodes on the GPU: {e}"))?;
        let scope = &mut self.js_runtime.handle_scope();
        Ok(v8::Local::new(scope, value).is_true())
    }

    fn take_three_frames(&mut self) -> HashMap<String, Arc<ImageAsset>> {
        let op_state = self.js_runtime.op_state();
        let mut state = op_state.borrow_mut();
        let store = state.borrow_mut::<ops::ThreeFrames>();
        std::mem::take(&mut store.0)
            .into_iter()
            .map(|(path, (width, height, rgba))| {
                (
                    path,
                    Arc::new(ImageAsset {
                        width,
                        height,
                        rgba,
                    }),
                )
            })
            .collect()
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
    async fn reads_mix_settings_roles_and_draws_captions() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vo_dir = dir.path().join("assets").join("audio").join("vo");
        std::fs::create_dir_all(&vo_dir)?;
        std::fs::write(
            vo_dir.join("h1.timing.json"),
            r#"{"lineId":"h1","duration":1.2,"words":[{"word":"Halo","start":0,"end":0.5},{"word":"semua.","start":0.6,"end":1.1}]}"#,
        )?;
        let composition_code = r##"
            import { captions, composition, scene } from "liosvideo";

            const hook = scene("hook", { duration: 2 }, ({ root }) => {
                captions(root, { lines: ["h1"] });
            });

            export default composition({
                width: 1080,
                height: 1920,
                fps: 30,
                scenes: [hook],
                mix: { loudness: -16, duck: false },
                audio: [{ id: "bgm", src: "assets/audio/music/bed.mp3", role: "music" }],
            });
        "##;
        std::fs::write(dir.path().join("short.ts"), composition_code)?;

        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        let info = host.load_composition("short.ts").await?;
        let mix = crate::media::loudness::MixSettings::from_json(info.mix.as_ref().expect("mix"));
        assert_eq!(mix.loudness, Some(-16.0));
        assert!(mix.duck.is_none());
        assert_eq!(info.audio[0].clips[0].role.as_deref(), Some("music"));

        let rl = host.evaluate_frame(9)?; // 0.3 s: "Halo" is being spoken
        let texts: Vec<&str> = rl["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|i| i["text"].as_str())
            .collect();
        assert_eq!(texts, vec!["Halo", "semua."]);
        Ok(())
    }

    /// A textured, shadowed MeshStandardMaterial scene: on the GPU path the checker texture and
    /// the shadow both show up (the software rasteriser can draw neither).
    #[tokio::test]
    async fn renders_a_textured_shadowed_scene_on_the_gpu() -> Result<()> {
        let dir = tempfile::tempdir()?;
        std::fs::write(
            dir.path().join("long.ts"),
            r##"
            import { composition, scene, three } from "liosvideo";
            import * as THREE from "three";
            const s = scene("s", { duration: 1 }, ({ root }) => {
              root.add(three({
                name: "stage", width: 160, height: 120, fov: 40, shadows: true,
                setup({ scene, camera }) {
                  scene.background = new THREE.Color("#102030");
                  camera.position.set(0, 4, 0.001); camera.lookAt(0, 0, 0);
                  const data = new Uint8Array(4 * 4 * 4);
                  for (let i = 0; i < 16; i++) data.set(((i + (i >> 2)) & 1) ? [255, 0, 0, 255] : [0, 255, 0, 255], i * 4);
                  const tex = new THREE.DataTexture(data, 4, 4); tex.needsUpdate = true;
                  const plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ map: tex }));
                  plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true; scene.add(plane);
                  const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: "#000000", colorWrite: false, depthWrite: false }));
                  blocker.position.set(0, 1, 0); blocker.castShadow = true; scene.add(blocker);
                  scene.add(new THREE.AmbientLight("#ffffff", 0.2));
                  const sun = new THREE.DirectionalLight("#ffffff", 3); sun.position.set(0, 5, 0); sun.castShadow = true; scene.add(sun);
                },
              }));
            });
            export default composition({ width: 160, height: 120, fps: 30, scenes: [s] });
            "##,
        )?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        host.load_composition("long.ts").await?;
        let frames = host.render_three_nodes(0, 30.0).await?;
        if !host.three_gpu {
            eprintln!("no GPU here; skipping the GPU render check");
            return Ok(());
        }
        let img = frames.values().next().expect("a three frame");
        assert_eq!((img.width, img.height), (160, 120));
        let px = |x: u32, y: u32| {
            let i = ((y * img.width + x) * 4) as usize;
            [
                img.rgba[i],
                img.rgba[i + 1],
                img.rgba[i + 2],
                img.rgba[i + 3],
            ]
        };
        let lit: Vec<[u8; 4]> = [(20, 60), (140, 60), (80, 15), (80, 105)]
            .iter()
            .map(|&(x, y)| px(x, y))
            .collect();
        assert!(
            lit.iter().any(|p| p[0] > 120 && p[1] < 60),
            "red texels: {lit:?}"
        );
        assert!(
            lit.iter().any(|p| p[1] > 120 && p[0] < 60),
            "green texels: {lit:?}"
        );
        let centre = px(80, 60);
        // lit texels read ~255 on one channel; in the shadow only the ambient light is left
        assert!(
            centre.iter().take(3).map(|&c| c as u32).sum::<u32>() < 150,
            "the blocker's shadow darkens the centre: {centre:?}"
        );
        assert_eq!(px(0, 0)[3], 255);
        Ok(())
    }

    /// A GLB: a 2x2 unlit quad "panel" textured with an embedded 2x1 PNG (red | green), and a
    /// 0.4x0.4 unlit blue quad "lid" as a separate node.
    fn test_glb() -> Vec<u8> {
        let mut png = Vec::new();
        image::RgbaImage::from_raw(2, 1, vec![255, 0, 0, 255, 0, 255, 0, 255])
            .unwrap()
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let f32s = |v: &[f32]| v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>();
        let mut bin = Vec::new();
        let mut views = Vec::new();
        let mut push = |bin: &mut Vec<u8>, bytes: &[u8]| {
            while !bin.len().is_multiple_of(4) {
                bin.push(0);
            }
            views.push(serde_json::json!({ "buffer": 0, "byteOffset": bin.len(), "byteLength": bytes.len() }));
            bin.extend_from_slice(bytes);
        };
        push(
            &mut bin,
            &f32s(&[-1., -1., 0., 1., -1., 0., 1., 1., 0., -1., 1., 0.]),
        );
        push(&mut bin, &f32s(&[0., 1., 1., 1., 1., 0., 0., 0.]));
        push(&mut bin, &[0, 0, 1, 0, 2, 0, 0, 0, 2, 0, 3, 0]);
        push(
            &mut bin,
            &f32s(&[-0.2, -0.2, 0., 0.2, -0.2, 0., 0.2, 0.2, 0., -0.2, 0.2, 0.]),
        );
        push(&mut bin, &png);
        while !bin.len().is_multiple_of(4) {
            bin.push(0);
        }
        let json = serde_json::json!({
            "asset": { "version": "2.0" },
            "extensionsUsed": ["KHR_materials_unlit"],
            "scene": 0,
            "scenes": [{ "nodes": [0, 1] }],
            "nodes": [
                { "name": "panel", "mesh": 0 },
                { "name": "lid", "mesh": 1, "translation": [0.5, 0.5, 0.1] }
            ],
            "meshes": [
                { "primitives": [{ "attributes": { "POSITION": 0, "TEXCOORD_0": 1 }, "indices": 2, "material": 0 }] },
                { "primitives": [{ "attributes": { "POSITION": 3 }, "indices": 2, "material": 1 }] }
            ],
            "materials": [
                { "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } }, "extensions": { "KHR_materials_unlit": {} } },
                { "pbrMetallicRoughness": { "baseColorFactor": [0, 0, 1, 1] }, "extensions": { "KHR_materials_unlit": {} } }
            ],
            "samplers": [{ "magFilter": 9728, "minFilter": 9728 }],
            "textures": [{ "source": 0, "sampler": 0 }],
            "images": [{ "bufferView": 4, "mimeType": "image/png" }],
            "buffers": [{ "byteLength": bin.len() }],
            "bufferViews": views,
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3", "min": [-1, -1, 0], "max": [1, 1, 0] },
                { "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC2" },
                { "bufferView": 2, "componentType": 5123, "count": 6, "type": "SCALAR" },
                { "bufferView": 3, "componentType": 5126, "count": 4, "type": "VEC3", "min": [-0.2, -0.2, 0], "max": [0.2, 0.2, 0] }
            ]
        });
        let mut text = serde_json::to_vec(&json).unwrap();
        while !text.len().is_multiple_of(4) {
            text.push(b' ');
        }
        let total = 12 + 8 + text.len() + 8 + bin.len();
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(&0x4654_6c67u32.to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&(total as u32).to_le_bytes());
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
        out.extend_from_slice(&0x4e4f_534au32.to_le_bytes());
        out.extend_from_slice(&text);
        out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        out.extend_from_slice(&0x004e_4942u32.to_le_bytes());
        out.extend_from_slice(&bin);
        out
    }

    fn glb_project() -> Result<tempfile::TempDir> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir_all(dir.path().join("assets/models"))?;
        std::fs::write(dir.path().join("assets/models/box.glb"), test_glb())?;
        std::fs::write(
            dir.path().join("long.ts"),
            r##"
            import { composition, gltf, scene, three } from "liosvideo";
            import * as THREE from "three";
            const s = scene("s", { duration: 1 }, ({ root }) => {
              root.add(three({
                name: "stage", width: 160, height: 160,
                async setup({ scene, camera }) {
                  scene.background = new THREE.Color("#000000");
                  camera.position.z = 2.2;
                  const model = await gltf("assets/models/box.glb");
                  scene.add(model.scene);
                  return { lid: model.part("lid") };
                },
                update({ lid }, progress) {
                  lid.position.x = 0.5 - progress; // a named part animates
                },
              }));
            });
            export default composition({ width: 160, height: 160, fps: 30, scenes: [s] });
            "##,
        )?;
        Ok(dir)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn renders_a_gltf_model_with_its_texture_on_the_gpu() -> Result<()> {
        let dir = glb_project()?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        host.load_composition("long.ts").await?;
        let frames = host.render_three_nodes(0, 30.0).await?;
        if !host.three_gpu {
            eprintln!("no GPU here; skipping the GPU glTF check");
            return Ok(());
        }
        let img = frames.values().next().expect("a three frame");
        let px = |x: u32, y: u32| {
            let i = ((y * img.width + x) * 4) as usize;
            [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]
        };
        let (left, right, lid) = (px(40, 120), px(120, 120), px(122, 38));
        assert!(
            left[0] > 200 && left[1] < 40,
            "texture left texel is red: {left:?}"
        );
        assert!(
            right[1] > 200 && right[0] < 40,
            "texture right texel is green: {right:?}"
        );
        assert!(lid[2] > 200 && lid[0] < 40, "the lid part is blue: {lid:?}");
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn runs_an_async_setup_in_the_software_rasteriser() -> Result<()> {
        let dir = glb_project()?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        host.load_composition("long.ts").await?;
        host.three_gpu = false;
        let frames = host.render_three_nodes(0, 30.0).await?;
        let img = frames
            .values()
            .next()
            .expect("a three frame after an async setup");
        let blue = img
            .rgba
            .chunks(4)
            .filter(|p| p[2] > 200 && p[0] < 40 && p[1] < 40)
            .count();
        assert!(
            blue > 50,
            "the lid from the glTF is drawn ({blue} blue pixels)"
        );
        Ok(())
    }

    /// A mirror ball under an equirect sky (top red, bottom blue) reflects red above and blue below.
    /// `env` builds the environment: an HDR through hdr(), or an 8-bit DataTexture (whose WGSL
    /// three writes with `u32( 0.0 )`, which naga 24 rejects without fixWgsl).
    async fn mirror_ball(env: &str) -> Result<Option<[[u8; 3]; 2]>> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir_all(dir.path().join("assets/hdri"))?;
        let (w, h) = (256usize, 128usize);
        let mut hdr = format!("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {h} +X {w}\n").into_bytes();
        for y in 0..h {
            for _ in 0..w {
                hdr.extend_from_slice(if y < h / 2 {
                    &[128, 0, 0, 129]
                } else {
                    &[0, 0, 128, 129]
                });
            }
        }
        std::fs::write(dir.path().join("assets/hdri/sky.hdr"), hdr)?;
        std::fs::write(
            dir.path().join("long.ts"),
            format!(
                r##"
            import {{ composition, hdr, scene, three }} from "liosvideo";
            import * as THREE from "three";
            const s = scene("s", {{ duration: 1 }}, ({{ root }}) => {{
              root.add(three({{
                name: "stage", width: 200, height: 200, fov: 90,
                async setup({{ scene, camera }}) {{
                  {env}
                  scene.environment = env;
                  camera.position.set(0, 0, 3);
                  scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), new THREE.MeshStandardMaterial({{ metalness: 1, roughness: 0 }})));
                }},
              }}));
            }});
            export default composition({{ width: 200, height: 200, fps: 30, scenes: [s] }});
            "##
            ),
        )?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        host.load_composition("long.ts").await?;
        let frames = host.render_three_nodes(0, 30.0).await?;
        if !host.three_gpu {
            return Ok(None);
        }
        let img = frames.values().next().expect("a three frame");
        let px = |x: u32, y: u32| {
            let i = ((y * img.width + x) * 4) as usize;
            [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]
        };
        Ok(Some([px(100, 82), px(100, 118)]))
    }

    #[tokio::test(flavor = "current_thread")]
    async fn reflects_an_hdr_environment_on_the_gpu() -> Result<()> {
        let Some([top, bottom]) =
            mirror_ball(r#"const env = await hdr("assets/hdri/sky.hdr");"#).await?
        else {
            eprintln!("no GPU here; skipping the environment check");
            return Ok(());
        };
        assert!(
            top[0] > 150 && top[2] < 60,
            "the ball reflects the red sky above: {top:?}"
        );
        assert!(
            bottom[2] > 150 && bottom[0] < 60,
            "and the blue ground below: {bottom:?}"
        );
        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn reflects_an_8_bit_environment_on_the_gpu() -> Result<()> {
        let env = r#"const d = new Uint8Array(256 * 128 * 4);
                  for (let i = 0; i < 256 * 128; i++) d.set(i < 256 * 64 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
                  const env = new THREE.DataTexture(d, 256, 128); env.flipY = true;
                  env.mapping = THREE.EquirectangularReflectionMapping; env.needsUpdate = true;"#;
        let Some([top, bottom]) = mirror_ball(env).await? else {
            eprintln!("no GPU here; skipping the environment check");
            return Ok(());
        };
        let lit = |p: [u8; 3]| p.iter().map(|&c| c as u32).sum::<u32>() > 150;
        assert!(
            lit(top) && lit(bottom),
            "the ball reflects the sky, not black: {top:?} {bottom:?}"
        );
        Ok(())
    }

    #[test]
    fn asset_reads_stay_inside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.bin"), [1u8, 2]).unwrap();
        assert_eq!(ops::read_asset(dir.path(), "./a.bin").unwrap(), vec![1, 2]);
        let outside = ops::read_asset(dir.path(), "../../../../../../etc/hosts").unwrap_err();
        assert!(outside.contains("outside the project"), "{outside}");
        assert!(ops::read_asset(dir.path(), "missing.glb")
            .unwrap_err()
            .contains("not found"));
    }

    #[test]
    fn decodes_images_with_a_size_header() {
        let mut png = Vec::new();
        image::RgbaImage::from_raw(2, 1, vec![9, 8, 7, 255, 1, 2, 3, 255])
            .unwrap()
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let out = ops::decode_image(&png).unwrap();
        assert_eq!(&out[..8], &[2, 0, 0, 0, 1, 0, 0, 0]);
        assert_eq!(&out[8..], &[9, 8, 7, 255, 1, 2, 3, 255]);
        assert!(ops::decode_image(&[1, 2, 3]).is_err());
    }

    #[tokio::test]
    async fn credits_an_asset_from_the_attributions_file() -> Result<()> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir_all(dir.path().join("assets"))?;
        std::fs::write(
            dir.path().join("assets").join("ATTRIBUTIONS.md"),
            "| Asset | Source / URL | Author / Creator | License | Notes |\n| :--- | :--- | :--- | :--- | :--- |\n| `assets/images/a.jpg` | https://x | Jane Doe | CC BY 4.0 | s1 |\n",
        )?;
        std::fs::write(
            dir.path().join("long.ts"),
            r##"
            import { composition, credit, scene } from "liosvideo";
            const s = scene("s", { duration: 1 }, ({ root }) => {
                credit(root, { source: "ANTARA", asset: "assets/images/a.jpg" });
            });
            export default composition({ width: 1920, height: 1080, fps: 30, scenes: [s] });
            "##,
        )?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        host.load_composition("long.ts").await?;
        let rl = host.evaluate_frame(0)?;
        let texts: Vec<&str> = rl["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|i| i["text"].as_str())
            .collect();
        assert_eq!(texts, vec!["Source: ANTARA • Photo: Jane Doe, CC BY 4.0"]);
        Ok(())
    }

    #[tokio::test]
    async fn credits_a_wikimedia_commons_download_from_its_row() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let licence = crate::commons::Licence {
            short: "CC BY-SA 4.0".into(),
            url: Some("https://creativecommons.org/licenses/by-sa/4.0".into()),
            attribution_required: true,
        };
        crate::commons::record_attribution(
            dir.path(),
            "assets/images/bukele.jpg",
            "https://commons.wikimedia.org/wiki/File:Presidente_Bukele_(cropped).jpg",
            "AndreX",
            &licence,
        )
        .map_err(|e| anyhow!(e))?;
        std::fs::write(
            dir.path().join("long.ts"),
            r##"
            import { composition, credit, scene } from "liosvideo";
            const s = scene("s", { duration: 1 }, ({ root }) => {
                credit(root, { asset: "assets/images/bukele.jpg", lang: "id" });
            });
            export default composition({ width: 1920, height: 1080, fps: 30, scenes: [s] });
            "##,
        )?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        host.load_composition("long.ts").await?;
        let rl = host.evaluate_frame(0)?;
        let texts: Vec<&str> = rl["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|i| i["text"].as_str())
            .collect();
        assert_eq!(texts, vec!["Foto: AndreX, CC BY-SA 4.0"]);
        Ok(())
    }

    #[tokio::test]
    async fn names_the_node_and_line_of_an_unknown_ease() -> Result<()> {
        let dir = tempfile::tempdir()?;
        std::fs::write(
            dir.path().join("long.ts"),
            r##"import { composition, scene, text } from "liosvideo";
const s = scene("s", { duration: 1 }, ({ root }) => {
  const t = root.add(text({ name: "title", text: "hi" }));
  t.to({ opacity: 1 }, { at: 0, duration: 0.5, ease: "inOutBounce" as any });
});
export default composition({ width: 640, height: 360, fps: 30, scenes: [s] });
"##,
        )?;
        let mut host = RuntimeHost::new(dir.path().to_path_buf())?;
        let err = host
            .load_composition("long.ts")
            .await
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("Unknown ease \"inOutBounce\" on node \"title\" (opacity)"),
            "{err}"
        );
        assert!(err.contains("long.ts:4"), "{err}");
        assert!(err.contains("inOutSine"), "{err}");
        Ok(())
    }

    #[tokio::test]
    async fn sizes_scenes_from_vo_timings_at_module_scope() -> Result<()> {
        let dir =
            std::env::temp_dir().join(format!("liosvideo_vo_duration_test_{}", std::process::id()));
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
    async fn lays_out_and_wraps_text_with_the_layout_helpers() -> Result<()> {
        let dir =
            std::env::temp_dir().join(format!("liosvideo_layout_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir)?;

        let composition_code = r##"
            import { composition, layout, scene, stack, text } from "liosvideo";

            const intro = scene("intro", { duration: 1.0 }, ({ root, width, height }) => {
                const L = layout({ width, height });
                root.add(stack(L.slot("caption"), [
                    text({ name: "line", text: "one two three four five six seven eight nine ten eleven twelve", ...L.type.h1 }),
                ], { gap: L.gap(2) }));
            });

            export default composition({ width: 640, height: 360, fps: 30, scenes: [intro] });
        "##;
        std::fs::write(dir.join("layout.ts"), composition_code)?;

        let mut host = RuntimeHost::new(dir.clone())?;
        let _ = host.load_composition("layout.ts").await?;
        let rl = host.evaluate_frame(0)?;
        let item = rl["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["kind"] == "text")
            .expect("text item")
            .clone();
        assert_eq!(item["align"], "center", "caption slot centres its text");
        assert!(item["boxWidth"].as_f64().unwrap() > 0.0);
        assert!(
            item["text"].as_str().unwrap().contains('\n'),
            "long caption wraps: {}",
            item["text"]
        );

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
