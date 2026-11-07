use anyhow::{anyhow, Context, Result};
use std::path::Path;

use crate::gpu::{GpuContext, RenderTarget, Renderer};
use crate::runtime::RuntimeHost;

/// Which frame a snapshot shows.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum At {
    Frame(usize),
    /// Seconds from the start, rounded to the nearest frame
    Time(f64),
}

/// The frame for `at`, clamped to the composition.
pub fn frame_for(at: At, fps: f64, total_frames: usize) -> usize {
    let frame = match at {
        At::Frame(frame) => frame,
        At::Time(seconds) => (seconds.max(0.0) * fps).round() as usize,
    };
    frame.min(total_frames.saturating_sub(1))
}

pub async fn render_snapshot(
    entry: &Path,
    frame: usize,
    out_png: &Path,
    preset: super::preset::Preset,
) -> Result<()> {
    render_snapshot_at(entry, At::Frame(frame), out_png, preset).await
}

pub async fn render_snapshot_at(
    entry: &Path,
    at: At,
    out_png: &Path,
    preset: super::preset::Preset,
) -> Result<()> {
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

    let mut host = RuntimeHost::new(project_root.clone())?;
    let comp_info = host.load_composition(&entry_file).await?;
    let frame = frame_for(at, comp_info.fps, comp_info.total_frames);

    let render_list = host.evaluate_frame(frame)?;
    let three_frames = host.render_three_nodes(frame, comp_info.fps).await?;
    let (_, scene_time, scene_progress) =
        crate::runtime::scene_clock(&comp_info, frame, comp_info.fps);

    let gpu = GpuContext::new_headless().await?;
    let (target_width, target_height) = preset.size(comp_info.width, comp_info.height);
    let target = RenderTarget::new(&gpu.device, target_width, target_height);
    let mut renderer = Renderer::new(&gpu.device, &gpu.queue, project_root);

    renderer.render_frame(
        &gpu.device,
        &gpu.queue,
        &target,
        &render_list,
        scene_time,
        scene_progress,
        &three_frames,
    )?;

    let rgba = target.read_rgba(&gpu.device, &gpu.queue).await?;

    if let Some(parent) = out_png.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    image::save_buffer(
        out_png,
        &rgba,
        target_width,
        target_height,
        image::ExtendedColorType::Rgba8,
    )
    .with_context(|| format!("Failed to save snapshot PNG to '{}'", out_png.display()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_frame_for_a_time() {
        assert_eq!(frame_for(At::Time(3.2), 30.0, 900), 96);
        assert_eq!(frame_for(At::Time(3.21), 30.0, 900), 96);
        assert_eq!(frame_for(At::Time(99.0), 30.0, 900), 899);
        assert_eq!(frame_for(At::Frame(42), 30.0, 900), 42);
    }
}
