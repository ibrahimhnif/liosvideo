use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};

use crate::cli::RenderProgressBar;
use crate::gpu::{GpuContext, RenderTarget, Renderer};
use crate::media::encoder::{EncoderThread, Mp4Encoder, VideoEncoderKind};
use crate::runtime::RuntimeHost;

use super::preset::{resolve_bitrate, Preset};

/// Configuration options for executing a render job.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderConfig {
    pub entry: PathBuf,
    pub out: PathBuf,
    pub fps: Option<f64>,
    pub frames: Option<String>,
    pub quality: Option<String>,
    pub preset: Preset,
    pub bitrate: Option<u32>,
    pub audio_bitrate: Option<u32>,
    /// Overrides the composition's loudness target: `Some(None)` keeps the raw level.
    pub loudness: Option<Option<f64>>,
    pub encoder: VideoEncoderKind,
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

    let (target_width, target_height) = config.preset.size(comp_info.width, comp_info.height);
    let video_bitrate = resolve_bitrate(config.bitrate, config.quality.as_deref(), config.preset);
    let audio_bitrate = config.audio_bitrate.unwrap_or_else(|| config.preset.audio_bitrate());

    let frame_range = parse_frame_range(config.frames.as_deref(), comp_info.total_frames)?;
    let total_render_frames = frame_range.len();
    if total_render_frames == 0 {
        return Err(anyhow!("No frames to render in range {:?}", frame_range));
    }

    // Pre-mix audio tracks if any exist in the composition
    let audio_pcm = if !comp_info.audio.is_empty() {
        let mut mix = comp_info
            .mix
            .as_ref()
            .map(crate::media::loudness::MixSettings::from_json)
            .unwrap_or_default();
        if let Some(target) = config.loudness {
            mix.loudness = target;
        }
        let mut pcm = crate::media::audio::mix_audio_tracks(
            &project_root,
            &comp_info.audio,
            comp_info.duration,
            crate::media::audio::DEFAULT_SAMPLE_RATE,
            fps,
            mix.duck,
        )?;
        // loudness is measured on the whole programme, before any --frames slice
        let report = crate::media::loudness::master(
            &mut pcm,
            crate::media::audio::DEFAULT_SAMPLE_RATE,
            &mix,
        );
        if !config.quiet {
            let lufs = |v: f64| {
                if v.is_finite() {
                    format!("{v:.1} LUFS")
                } else {
                    "silent".into()
                }
            };
            println!(
                "Audio: {} -> {} (gain {:+.1} dB, peak {:.1} dBFS{})",
                lufs(report.measured),
                lufs(report.final_lufs),
                report.gain,
                report.peak,
                if mix.duck.is_some() {
                    ", music ducked under VO"
                } else {
                    ""
                }
            );
        }
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
    // Two targets: the GPU renders frame N+1 into one while the CPU reads and encodes frame N
    // from the other. Frames still go to the encoder in order and are drawn exactly as before.
    let targets = [
        RenderTarget::new(&gpu.device, target_width, target_height),
        RenderTarget::new(&gpu.device, target_width, target_height),
    ];
    let mut in_flight: Option<(usize, crate::gpu::PendingRead)> = None;
    let mut renderer = Renderer::new(&gpu.device, &gpu.queue, project_root.clone());

    // Initialize in-binary MP4 encoder
    let out = config.out.clone();
    let kind = config.encoder;
    let mut encoder = EncoderThread::spawn(3, move || {
        Mp4Encoder::new_with_encoder(
            &out,
            target_width,
            target_height,
            fps,
            crate::media::audio::DEFAULT_SAMPLE_RATE,
            video_bitrate,
            audio_bitrate,
            kind,
        )
    })?;

    if !config.quiet {
        println!(
            "Rendering: {} ({}x{} @ {}fps, {} frames: {}..{}, {} Mbps video, {})",
            entry_file,
            target_width,
            target_height,
            fps,
            total_render_frames,
            frame_range.start,
            frame_range.end,
            video_bitrate as f64 / 1_000_000.0,
            encoder.encoder_name()
        );
    }

    let progress = RenderProgressBar::new(total_render_frames as u64, config.quiet);
    let mut times = StageTimes::default();

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

        let t = std::time::Instant::now();
        let render_list = host.evaluate_frame(frame)?;
        let t = times.add(Stage::Evaluate, t);
        let three_frames = host.render_three_nodes(frame, fps).await?;
        let t = times.add(Stage::Three, t);
        let (_, scene_time, scene_progress) = crate::runtime::scene_clock(&comp_info, frame, fps);
        let slot = frame % 2;
        renderer.render_frame(
            &gpu.device,
            &gpu.queue,
            &targets[slot],
            &render_list,
            scene_time,
            scene_progress,
            &three_frames,
        )?;
        let pending = targets[slot].begin_read(&gpu.device, &gpu.queue);
        times.add(Stage::Gpu, t);
        if let Some((prev, read)) = in_flight.replace((slot, pending)) {
            collect_frame(&targets[prev], read, &gpu.device, &mut encoder, &mut times)?;
            progress.inc();
        }
    }
    if let Some((prev, read)) = in_flight.take() {
        collect_frame(&targets[prev], read, &gpu.device, &mut encoder, &mut times)?;
        progress.inc();
    }

    let t = std::time::Instant::now();
    let encode_busy = encoder.finish_with_audio(audio_pcm)?;
    times.add(Stage::Encode, t);
    progress.finish_with_message("Done");

    // Never hand over a file that only looks fine until a player hits a broken reference frame.
    let report = crate::media::integrity::check_file(&config.out, Some(total_render_frames as u32))
        .map_err(|e| {
            anyhow!(
                "Render integrity check failed for {}: {e}",
                config.out.display()
            )
        })?;
    if !config.quiet {
        println!(
            "Integrity: OK ({} frames, {} keyframes)",
            report.frames, report.keyframes
        );
    }

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
        println!(
            "Time: {} (encoder busy {:.1} s on its own thread)",
            times.summary(),
            encode_busy.as_secs_f64()
        );
    }

    Ok(())
}

/// Waits for a frame's copy, then hands the pixels to the encoder.
fn collect_frame(
    target: &RenderTarget,
    read: crate::gpu::PendingRead,
    device: &wgpu::Device,
    encoder: &mut EncoderThread,
    times: &mut StageTimes,
) -> Result<()> {
    let t = std::time::Instant::now();
    let rgba = target.finish_read(device, read)?;
    let t = times.add(Stage::Readback, t);
    encoder.push_frame(rgba)?;
    times.add(Stage::Encode, t);
    Ok(())
}

/// Where a render spends its time, so a slow render can be traced to one stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// Scene code: keyframes, layout, the render list
    Evaluate,
    /// three() nodes
    Three,
    /// Drawing the frame on the GPU
    Gpu,
    /// Copying the frame back to the CPU
    Readback,
    /// Colour conversion, H.264 and muxing
    Encode,
}

const STAGES: [(Stage, &str); 5] = [
    (Stage::Evaluate, "evaluate"),
    (Stage::Three, "3d"),
    (Stage::Gpu, "gpu"),
    (Stage::Readback, "readback"),
    (Stage::Encode, "encode"),
];

#[derive(Debug, Default, Clone)]
pub struct StageTimes {
    secs: [f64; 5],
}

impl StageTimes {
    /// Adds the time since `since` to `stage` and returns now, to time the next stage from.
    pub fn add(&mut self, stage: Stage, since: std::time::Instant) -> std::time::Instant {
        let now = std::time::Instant::now();
        self.add_secs(stage, (now - since).as_secs_f64());
        now
    }

    pub fn add_secs(&mut self, stage: Stage, secs: f64) {
        let i = STAGES.iter().position(|(s, _)| *s == stage).unwrap_or(0);
        self.secs[i] += secs;
    }

    pub fn secs(&self, stage: Stage) -> f64 {
        STAGES
            .iter()
            .position(|(s, _)| *s == stage)
            .map(|i| self.secs[i])
            .unwrap_or(0.0)
    }

    /// e.g. `evaluate 1.2 s (10%) · gpu 3.0 s (25%) · encode 7.8 s (65%)`; stages that took no
    /// time are left out.
    pub fn summary(&self) -> String {
        let total: f64 = self.secs.iter().sum();
        STAGES
            .iter()
            .zip(self.secs)
            .filter(|(_, secs)| *secs >= 0.0005)
            .map(|((_, name), secs)| {
                let share = if total > 0.0 { secs / total * 100.0 } else { 0.0 };
                format!("{name} {secs:.1} s ({share:.0}%)")
            })
            .collect::<Vec<_>>()
            .join(" · ")
    }
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
                println!("    [{}] \"{}\":", i + 1, track.id);
                for clip in &track.clips {
                    println!(
                        "      - src={:?}, start_frame={}, duration={:?}, start_offset={:?}, volume={:?}",
                        clip.src, clip.start_frame, clip.duration, clip.start_offset, clip.volume
                    );
                }
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

    #[test]
    fn summarises_where_the_render_time_went() {
        let mut t = StageTimes::default();
        t.add_secs(Stage::Evaluate, 1.0);
        t.add_secs(Stage::Gpu, 1.0);
        t.add_secs(Stage::Encode, 2.0);
        assert_eq!(t.secs(Stage::Encode), 2.0);
        assert_eq!(
            t.summary(),
            "evaluate 1.0 s (25%) · gpu 1.0 s (25%) · encode 2.0 s (50%)"
        );
    }
}
