// `liosvideo contact-sheet`: one image with labelled frames (one per scene, or every N seconds),
// rendered from a single loaded composition and GPU context.

use std::path::Path;

use anyhow::{anyhow, Result};

use crate::gpu::{GpuContext, RenderTarget, Renderer};
use crate::runtime::{CompositionInfo, RuntimeHost};
use crate::text::{TextEngine, TextProps};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pick {
    /// The middle frame of every scene
    PerScene,
    /// A frame every `n` seconds, starting at 0
    Every(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cell {
    pub frame: usize,
    pub scene_index: usize,
    pub label: String,
}

/// "2s", "2.5", "500ms" -> seconds.
pub fn parse_seconds(value: &str) -> Result<f64> {
    let v = value.trim().to_ascii_lowercase();
    let (number, scale) = if let Some(ms) = v.strip_suffix("ms") {
        (ms, 0.001)
    } else if let Some(s) = v.strip_suffix('s') {
        (s, 1.0)
    } else {
        (v.as_str(), 1.0)
    };
    let seconds = number
        .trim()
        .parse::<f64>()
        .map_err(|_| anyhow!("not a duration: '{value}' (use e.g. 2s, 1.5 or 500ms)"))?
        * scale;
    if !(seconds > 0.0 && seconds.is_finite()) {
        return Err(anyhow!("the interval must be more than 0 s: '{value}'"));
    }
    Ok(seconds)
}

fn scene_of(info: &CompositionInfo, frame: usize) -> usize {
    info.scenes
        .iter()
        .position(|s| frame >= s.start_frame && frame < s.end_frame)
        .unwrap_or(0)
}

/// The frames a contact sheet shows, each labelled "<n> · <scene id> · <t> s · f<frame>".
pub fn pick_frames(info: &CompositionInfo, pick: Pick) -> Vec<Cell> {
    let fps = info.fps.max(0.0001);
    let total = info.total_frames.max(1);
    let frames: Vec<usize> = match pick {
        Pick::PerScene if !info.scenes.is_empty() => info
            .scenes
            .iter()
            .map(|s| (s.start_frame + s.end_frame.max(s.start_frame + 1) - 1) / 2)
            .collect(),
        Pick::PerScene => vec![total / 2],
        Pick::Every(step) => {
            let mut out = Vec::new();
            let mut t = 0.0;
            while out.len() < 400 {
                let frame = (t * fps).round() as usize;
                if frame >= total {
                    break;
                }
                out.push(frame);
                t += step;
            }
            out
        }
    };
    frames
        .into_iter()
        .enumerate()
        .map(|(i, frame)| {
            let scene_index = scene_of(info, frame);
            let id = info.scenes.get(scene_index).map(|s| s.id.as_str()).unwrap_or("");
            Cell {
                frame,
                scene_index,
                label: format!("{} · {} · {:.2} s · f{}", i + 1, id, frame as f64 / fps, frame),
            }
        })
        .collect()
}

pub struct SheetSummary {
    pub cells: usize,
    pub width: u32,
    pub height: u32,
}

const GAP: u32 = 8;
const LABEL_H: u32 = 30;
const BG: [u8; 4] = [17, 19, 24, 255];

/// Renders the picked frames at `cell_width` px wide into a grid of `cols` columns.
pub async fn render_contact_sheet(
    entry: &Path,
    pick: Pick,
    cols: u32,
    cell_width: u32,
    out_png: &Path,
) -> Result<SheetSummary> {
    let entry_path = if entry.is_absolute() {
        entry.to_path_buf()
    } else {
        std::env::current_dir()?.join(entry)
    };
    if !entry_path.exists() && !entry_path.with_extension("ts").exists() {
        return Err(anyhow!("Entry file not found: '{}'", entry.display()));
    }
    let project_root = entry_path.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
    let entry_file = entry_path
        .file_name()
        .ok_or_else(|| anyhow!("Entry path has no filename: '{}'", entry.display()))?
        .to_string_lossy()
        .to_string();

    let mut host = RuntimeHost::new(project_root.clone())?;
    let info = host.load_composition(&entry_file).await?;
    let cells = pick_frames(&info, pick);

    let cell_w = cell_width.clamp(64, 1920);
    let cell_h = ((cell_w as f64) * info.height as f64 / info.width.max(1) as f64).round().max(1.0) as u32;
    let cols = cols.clamp(1, 12).min(cells.len().max(1) as u32);
    let rows = (cells.len() as u32).div_ceil(cols).max(1);
    let sheet_w = GAP + cols * (cell_w + GAP);
    let sheet_h = GAP + rows * (cell_h + LABEL_H + GAP);
    let mut sheet = image::RgbaImage::from_pixel(sheet_w, sheet_h, image::Rgba(BG));

    let gpu = GpuContext::new_headless().await?;
    let target = RenderTarget::new(&gpu.device, cell_w, cell_h);
    let mut renderer = Renderer::new(&gpu.device, &gpu.queue, project_root);
    let mut text = TextEngine::new();

    for (i, cell) in cells.iter().enumerate() {
        let render_list = host.evaluate_frame(cell.frame)?;
        let three_frames = host.render_three_nodes(cell.frame, info.fps).await?;
        let (_, scene_time, scene_progress) = crate::runtime::scene_clock(&info, cell.frame, info.fps);
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
        let frame = image::RgbaImage::from_raw(cell_w, cell_h, rgba)
            .ok_or_else(|| anyhow!("frame {} has the wrong size", cell.frame))?;

        let col = i as u32 % cols;
        let row = i as u32 / cols;
        let x = GAP + col * (cell_w + GAP);
        let y = GAP + row * (cell_h + LABEL_H + GAP);
        image::imageops::overlay(&mut sheet, &frame, x as i64, y as i64);
        draw_label(&mut sheet, &mut text, &cell.label, x, y + cell_h, cell_w);
    }

    if let Some(parent) = out_png.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    sheet.save(out_png)?;
    Ok(SheetSummary {
        cells: cells.len(),
        width: sheet_w,
        height: sheet_h,
    })
}

/// White label text, left-aligned in the strip under a cell, clipped to the cell width.
fn draw_label(sheet: &mut image::RgbaImage, text: &mut TextEngine, label: &str, x: u32, y: u32, width: u32) {
    let props = TextProps {
        text: label.to_string(),
        font_family: "SF Mono".to_string(),
        font_size: 15.0,
        font_weight: 500,
        line_height: 1.2,
        align: "left".to_string(),
        box_width: 0.0,
    };
    let raster = text.raster(&props, "#e6e8ee", 1.0);
    let img = &raster.image;
    let top = y + (LABEL_H.saturating_sub(img.height)) / 2;
    for py in 0..img.height {
        for px in 0..img.width.min(width.saturating_sub(4)) {
            let (sx, sy) = (x + 2 + px, top + py);
            if sx >= sheet.width() || sy >= sheet.height() {
                continue;
            }
            let i = ((py * img.width + px) * 4) as usize;
            // the raster is premultiplied
            let [r, g, b, a] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
            if a == 0 {
                continue;
            }
            let dst = sheet.get_pixel_mut(sx, sy);
            let inv = 255 - a as u32;
            for (c, s) in [r, g, b].into_iter().enumerate() {
                dst.0[c] = (s as u32 + dst.0[c] as u32 * inv / 255).min(255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::SceneInfo;

    fn six_scene_short() -> CompositionInfo {
        let scenes: Vec<SceneInfo> = (0..6)
            .map(|i| SceneInfo {
                id: format!("s{i}"),
                start_frame: i * 90,
                end_frame: (i + 1) * 90,
                duration: 3.0,
            })
            .collect();
        CompositionInfo {
            width: 1080,
            height: 1920,
            fps: 30.0,
            duration: 18.0,
            total_frames: 540,
            background: "#000".into(),
            scenes,
            audio: vec![],
            mix: None,
        }
    }

    #[test]
    fn picks_the_middle_frame_of_every_scene() {
        let cells = pick_frames(&six_scene_short(), Pick::PerScene);
        assert_eq!(cells.iter().map(|c| c.frame).collect::<Vec<_>>(), vec![44, 134, 224, 314, 404, 494]);
        assert_eq!(cells[1].scene_index, 1);
        assert_eq!(cells[1].label, "2 · s1 · 4.47 s · f134");
    }

    #[test]
    fn picks_a_frame_every_interval_inside_the_video() {
        let cells = pick_frames(&six_scene_short(), Pick::Every(5.0));
        assert_eq!(cells.iter().map(|c| c.frame).collect::<Vec<_>>(), vec![0, 150, 300, 450]);
        assert_eq!(cells[3].scene_index, 5);
    }

    #[test]
    fn parses_intervals() {
        assert_eq!(parse_seconds("2s").unwrap(), 2.0);
        assert_eq!(parse_seconds("1.5").unwrap(), 1.5);
        assert_eq!(parse_seconds("500ms").unwrap(), 0.5);
        assert!(parse_seconds("0").is_err());
        assert!(parse_seconds("soon").is_err());
    }
}
