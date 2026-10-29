use anyhow::{anyhow, Context, Result};
use std::path::Path;

use crate::gpu::{GpuContext, RenderTarget, Renderer};
use crate::runtime::RuntimeHost;

pub async fn render_snapshot(entry: &Path, frame: usize, out_png: &Path) -> Result<()> {
    let entry_path = if entry.is_absolute() {
        entry.to_path_buf()
    } else {
        std::env::current_dir()?.join(entry)
    };

    if !entry_path.exists() && !entry_path.with_extension("ts").exists() {
        return Err(anyhow!("Entry file not found: '{}'", entry.display()));
    }

    let project_root = entry_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    let entry_file = entry_path
        .file_name()
        .ok_or_else(|| anyhow!("Entry path has no filename: '{}'", entry.display()))?
        .to_string_lossy();

    let mut host = RuntimeHost::new(project_root)?;
    let comp_info = host.load_composition(&entry_file).await?;

    let render_list = host.evaluate_frame(frame)?;

    let gpu = GpuContext::new_headless().await?;
    let target = RenderTarget::new(&gpu.device, comp_info.width, comp_info.height);
    let renderer = Renderer::new(&gpu.device, target.format);

    renderer.render_frame(&gpu.device, &gpu.queue, &target, &render_list)?;

    let rgba = target.read_rgba(&gpu.device, &gpu.queue).await?;

    if let Some(parent) = out_png.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    image::save_buffer(
        out_png,
        &rgba,
        comp_info.width,
        comp_info.height,
        image::ExtendedColorType::Rgba8,
    )
    .with_context(|| format!("Failed to save snapshot PNG to '{}'", out_png.display()))?;

    Ok(())
}
