use std::path::{Path, PathBuf};
use anyhow::{anyhow, Context, Result};

use crate::cli::RenderProgressBar;
use crate::gpu::{GpuContext, RenderTarget, Renderer};
use crate::media::encoder::Mp4Encoder;
use crate::runtime::RuntimeHost;

/// Configuration options for executing a render job.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderConfig {
    pub entry: PathBuf,
    pub out: PathBuf,
    pub fps: Option<f64>,
    pub frames: Option<String>,
    pub quality: String,
    pub quiet: bool,
}

/// Resolve composition entry file and determine the project root.
pub fn resolve_entry(entry: &Path) -> Result<(PathBuf, String)> {
    let entry_path = if entry.is_absolute() {
        entry.to_path_buf()
    } else {
        std::env::current_dir()?.join(entry)
    };

    let resolved_path = if entry_path.exists() {
        entry_path
    } else if entry_path.with_extension("ts").exists() {
        entry_path.with_extension("ts")
    } else {
        return Err(anyhow!("Entry file not found: '{}'", entry.display()));
    };

    let project_root = resolved_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    let entry_file = resolved_path
        .file_name()
        .ok_or_else(|| anyhow!("Entry path has no filename: '{}'", entry.display()))?
        .to_string_lossy()
        .to_string();

    Ok((project_root, entry_file))
}

/// Parse a frame range string into a concrete `Range<usize>`.
///
/// Supported formats:
/// - `None` or `""`: `0..total_frames`
/// - `"start..end"`: `start..end`
/// - `"start..=end"`: `start..end + 1`
/// - `"start-end"`: `start..end`
/// - `"..end"`: `0..end`
/// - `"start.."`: `start..total_frames`
/// - `"N"`: single frame `N..N+1`
pub fn parse_frame_range(
    range_str: Option<&str>,
    total_frames: usize,
) -> Result<std::ops::Range<usize>> {
    let Some(s) = range_str.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(0..total_frames);
    };

    let (start, end) = if let Some((start_s, end_s)) = s.split_once("..=") {
        let start = if start_s.trim().is_empty() {
            0
        } else {
            start_s.trim().parse::<usize>()?
        };
        let end = end_s.trim().parse::<usize>()? + 1;
        (start, end)
    } else if let Some((start_s, end_s)) = s.split_once("..") {
        let start = if start_s.trim().is_empty() {
            0
        } else {
            start_s.trim().parse::<usize>()?
        };
        let end = if end_s.trim().is_empty() {
            total_frames
        } else {
            end_s.trim().parse::<usize>()?
        };
        (start, end)
    } else if let Some((start_s, end_s)) = s.split_once('-') {
        let start = if start_s.trim().is_empty() {
            0
        } else {
            start_s.trim().parse::<usize>()?
        };
        let end = if end_s.trim().is_empty() {
            total_frames
        } else {
            end_s.trim().parse::<usize>()?
        };
        (start, end)
    } else {
        let frame = s.parse::<usize>()?;
        (frame, frame + 1)
    };

    if start > end {
        return Err(anyhow!(
            "Invalid frame range '{s}': start ({start}) cannot exceed end ({end})"
        ));
    }

    let clamped_end = end.min(total_frames);
    let clamped_start = start.min(clamped_end);
    Ok(clamped_start..clamped_end)
}

/// Execute the full video render pipeline:
///
/// 1. Boots `RuntimeHost` and loads composition metadata.
/// 2. Pre-mixes audio tracks at 48kHz via Symphonia and software mixer.
/// 3. Initializes headless `GpuContext`, `RenderTarget`, and `Renderer`.
/// 4. Initializes `Mp4Encoder`.
/// 5. Evaluates each frame, renders via WebGPU, reads back RGBA bytes, and pushes to encoder.
/// 6. Pushes audio PCM and finalizes the MP4 container.
pub async fn run_render_job(config: RenderConfig) -> Result<()> {
    let start_instant = std::time::Instant::now();
    let (project_root, entry_file) = resolve_entry(&config.entry)?;

    let mut host = RuntimeHost::new(project_root.clone())?;
    let comp_info = host.load_composition(&entry_file).await?;

    let fps = config.fps.unwrap_or(comp_info.fps);
    if fps <= 0.0 {
        return Err(anyhow!("Framerate must be positive, got {}", fps));
    }

    let frame_range = parse_frame_range(config.frames.as_deref(), comp_info.total_frames)?;
    let total_render_frames = frame_range.len();
    if total_render_frames == 0 {
        return Err(anyhow!("No frames to render in range {:?}", frame_range));
    }

    // Pre-mix audio tracks if any exist in the composition
    let audio_pcm = if !comp_info.audio.is_empty() {
        let pcm = crate::media::audio::mix_audio_tracks_with_fps(
            &project_root,
            &comp_info.audio,
            comp_info.duration,
            crate::media::audio::DEFAULT_SAMPLE_RATE,
            fps,
        )?;
        let start_sec = frame_range.start as f64 / fps;
        let end_sec = frame_range.end as f64 / fps;
        let start_sample = (((start_sec * 48_000.0).round() as usize) * 2).min(pcm.len());
        let end_sample = (((end_sec * 48_000.0).round() as usize) * 2).min(pcm.len());
        if start_sample < end_sample {
            pcm[start_sample..end_sample].to_vec()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // Initialize headless GPU context, offscreen target, and renderer
    let gpu = GpuContext::new_headless().await?;
    let target = RenderTarget::new(&gpu.device, comp_info.width, comp_info.height);
    let renderer = Renderer::new(&gpu.device, target.format);

    // Initialize in-binary MP4 encoder
    let mut encoder = Mp4Encoder::new(
        &config.out,
        comp_info.width,
        comp_info.height,
        fps,
        crate::media::audio::DEFAULT_SAMPLE_RATE,
    )?;

    if !config.quiet {
        println!(
            "Rendering: {} ({}x{} @ {}fps, {} frames: {}..{})",
            entry_file,
            comp_info.width,
            comp_info.height,
            fps,
            total_render_frames,
            frame_range.start,
            frame_range.end
        );
    }

    let progress = RenderProgressBar::new(total_render_frames as u64, config.quiet);

    for frame in frame_range {
        if let Some(scene) = comp_info
            .scenes
            .iter()
            .find(|s| frame >= s.start_frame && frame < s.end_frame)
        {
            progress.set_scene(&scene.id);
        } else {
            progress.set_scene("rendering");
        }

        let render_list = host.evaluate_frame(frame)?;
        renderer.render_frame(&gpu.device, &gpu.queue, &target, &render_list)?;
        let rgba = target.read_rgba(&gpu.device, &gpu.queue).await?;
        encoder.push_frame(&rgba)?;
        progress.inc();
    }

    if !audio_pcm.is_empty() {
        encoder.push_audio(&audio_pcm)?;
    }

    encoder.finish()?;
    progress.finish_with_message("Done");

    if !config.quiet {
        let elapsed = start_instant.elapsed();
        let render_fps = if elapsed.as_secs_f64() > 0.0 {
            total_render_frames as f64 / elapsed.as_secs_f64()
        } else {
            0.0
        };
        println!(
            "Render complete: {} ({} frames in {:.2?}, {:.1} fps)",
            config.out.display(),
            total_render_frames,
            elapsed,
            render_fps
        );
    }

    Ok(())
}

/// Inspect composition metadata and print human-readable summary or JSON.
pub async fn run_info_job(entry: &Path, json: bool) -> Result<()> {
    let (project_root, entry_file) = resolve_entry(entry)?;
    let mut host = RuntimeHost::new(project_root)?;
    let comp_info = host.load_composition(&entry_file).await?;

    if json {
        let json_str = serde_json::to_string_pretty(&comp_info)
            .context("Failed to serialize composition metadata to JSON")?;
        println!("{}", json_str);
    } else {
        println!("Composition: {}", entry.display());
        println!("  Resolution: {}x{}", comp_info.width, comp_info.height);
        println!("  FPS:        {}", comp_info.fps);
        println!(
            "  Duration:   {:.2}s ({} frames)",
            comp_info.duration, comp_info.total_frames
        );
        println!("  Background: {}", comp_info.background);
        println!("  Scenes ({}):", comp_info.scenes.len());
        for (i, scene) in comp_info.scenes.iter().enumerate() {
            println!(
                "    [{}] \"{}\": frames {}..{} ({:.2}s)",
                i + 1,
                scene.id,
                scene.start_frame,
                scene.end_frame,
                scene.duration
            );
        }
        if !comp_info.audio.is_empty() {
            println!("  Audio Tracks ({}):", comp_info.audio.len());
            for (i, track) in comp_info.audio.iter().enumerate() {
                println!(
                    "    [{}] \"{}\": src={:?}, start_at={:?}, volume={:?}, loop={:?}",
                    i + 1,
                    track.id,
                    track.src,
                    track.start_at,
                    track.volume,
                    track.loop_track
                );
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frame_range_variants() {
        assert_eq!(parse_frame_range(None, 100).unwrap(), 0..100);
        assert_eq!(parse_frame_range(Some(""), 100).unwrap(), 0..100);
        assert_eq!(parse_frame_range(Some("0..30"), 100).unwrap(), 0..30);
        assert_eq!(parse_frame_range(Some("0..=29"), 100).unwrap(), 0..30);
        assert_eq!(parse_frame_range(Some("0-30"), 100).unwrap(), 0..30);
        assert_eq!(parse_frame_range(Some("10..50"), 100).unwrap(), 10..50);
        assert_eq!(parse_frame_range(Some("..25"), 100).unwrap(), 0..25);
        assert_eq!(parse_frame_range(Some("75.."), 100).unwrap(), 75..100);
        assert_eq!(parse_frame_range(Some("42"), 100).unwrap(), 42..43);

        // Clamping to total_frames
        assert_eq!(parse_frame_range(Some("0..200"), 50).unwrap(), 0..50);
        assert_eq!(parse_frame_range(Some("100..200"), 50).unwrap(), 50..50);

        // Invalid range
        assert!(parse_frame_range(Some("50..10"), 100).is_err());
    }
}
