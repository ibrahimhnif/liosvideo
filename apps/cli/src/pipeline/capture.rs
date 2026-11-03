// Headless composition inspection and frame capture used by the MCP tools.
//
// `RuntimeHost` owns a V8 isolate and is not `Send`, so every operation runs inside
// `spawn_blocking` with its own current-thread Tokio runtime.

use std::path::PathBuf;

use anyhow::{anyhow, Result};
use image::ImageEncoder;
use serde_json::Value;

use crate::gpu::{GpuContext, RenderTarget, Renderer};
use crate::runtime::{CompositionInfo, RuntimeHost};

#[derive(Debug, Clone)]
pub struct LoadedComposition {
    pub info: CompositionInfo,
    pub manifest: Value,
}

fn block_on_local<F, T>(f: F) -> Result<T>
where
    F: std::future::Future<Output = Result<T>>,
{
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(f)
}

/// Load composition metadata + timeline manifest.
pub async fn inspect_composition(
    project_root: PathBuf,
    entry: String,
) -> Result<LoadedComposition> {
    tokio::task::spawn_blocking(move || {
        block_on_local(async move {
            let mut host = RuntimeHost::new(project_root)?;
            let info = host.load_composition(&entry).await?;
            let manifest = host.manifest().clone();
            Ok(LoadedComposition { info, manifest })
        })
    })
    .await
    .map_err(|e| anyhow!("capture task failed: {e}"))?
}

/// Render one frame to PNG bytes (composition resolution, no preset scaling).
pub async fn render_png(
    project_root: PathBuf,
    entry: String,
    frame: usize,
) -> Result<(Vec<u8>, u32, u32)> {
    tokio::task::spawn_blocking(move || {
        block_on_local(async move {
            let mut host = RuntimeHost::new(project_root.clone())?;
            let info = host.load_composition(&entry).await?;
            let render_list = host.evaluate_frame(frame)?;
            let three_frames = host.render_three_nodes(frame, info.fps)?;
            let (_, time, progress) = crate::runtime::scene_clock(&info, frame, info.fps);

            let gpu = GpuContext::new_headless().await?;
            let target = RenderTarget::new(&gpu.device, info.width, info.height);
            let mut renderer = Renderer::new(&gpu.device, &gpu.queue, project_root);
            renderer.render_frame(
                &gpu.device,
                &gpu.queue,
                &target,
                &render_list,
                time,
                progress,
                &three_frames,
            )?;
            let rgba = target.read_rgba(&gpu.device, &gpu.queue).await?;

            let mut png = Vec::new();
            image::codecs::png::PngEncoder::new(&mut png).write_image(
                &rgba,
                info.width,
                info.height,
                image::ExtendedColorType::Rgba8,
            )?;

            Ok((png, info.width, info.height))
        })
    })
    .await
    .map_err(|e| anyhow!("capture task failed: {e}"))?
}
