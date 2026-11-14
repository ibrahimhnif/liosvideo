//! Reframing a clip for another aspect (16:9 footage in a 9:16 short): where the crop window sits
//! over time so the speaker stays in frame, and where the camera cuts.
//!
//! Every frame gives a tiny luma thumbnail (cuts are big jumps between neighbours); a few frames a
//! second give a MODNet mask, whose column sums say where people are. The window is the stretch of
//! columns with the most person in it, so in a two-shot it settles on one person rather than the
//! empty middle. Within a shot the position holds still unless the person really moves, and then
//! follows smoothly; at a cut it jumps. The result is the `focus` of a clip's timing
//! (`[{ start, end, keys: [[t, focusX]] }]`), which `clipVideo` turns into `focusX`.

use std::path::Path;

use anyhow::{bail, Context, Result};
use image::{GrayImage, RgbImage};
use serde::Serialize;

use super::Matter;
use crate::assets::{for_each_video_frame, video_info};

/// Mean luma difference (0..1) between neighbouring thumbnails that counts as a cut.
pub const CUT: f32 = 0.11;
/// Less movement than this (fraction of the free travel) keeps the window where it is.
const DEAD_ZONE: f64 = 0.08;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub keys: Vec<(f64, f64)>,
}

/// Width of the crop window as a fraction of the source width (1 = no horizontal crop).
pub fn window(src_w: u32, src_h: u32, out_aspect: f64) -> f64 {
    ((out_aspect * src_h as f64) / src_w as f64).min(1.0)
}

/// Share of each column the subject covers (pixels at least half opaque; faint alpha on scenery
/// with no one in it does not count).
pub fn columns(mask: &GrayImage) -> Vec<f32> {
    let (w, h) = mask.dimensions();
    (0..w)
        .map(|x| (0..h).filter(|&y| mask.get_pixel(x, y)[0] >= 128).count() as f32 / h as f32)
        .collect()
}

/// A 32×18 luma thumbnail of an RGBA frame, read straight from its pixels (box average).
pub fn thumbnail(rgba: &[u8], width: u32, height: u32) -> GrayImage {
    let (tw, th) = (32u32, 18u32);
    GrayImage::from_fn(tw, th, |tx, ty| {
        let (x0, x1) = (tx * width / tw, ((tx + 1) * width / tw).max(tx * width / tw + 1));
        let (y0, y1) = (ty * height / th, ((ty + 1) * height / th).max(ty * height / th + 1));
        let (mut sum, mut n) = (0u64, 0u64);
        for y in (y0..y1).step_by(2) {
            for x in (x0..x1).step_by(2) {
                let p = ((y * width + x) * 4) as usize;
                sum += (rgba[p] as u64 * 54 + rgba[p + 1] as u64 * 183 + rgba[p + 2] as u64 * 19) >> 8;
                n += 1;
            }
        }
        image::Luma([(sum / n.max(1)) as u8])
    })
}

/// `focusX` (0..1) that puts the window of width `k` over the most person, or None with nobody in shot.
pub fn best_focus(cols: &[f32], k: f64) -> Option<f64> {
    let n = cols.len();
    let total: f32 = cols.iter().sum();
    if n == 0 || total < 0.01 * n as f32 || k >= 1.0 {
        return None;
    }
    let win = ((k * n as f64).round() as usize).clamp(1, n);
    let mut sum: f32 = cols[..win].iter().sum();
    let (mut best, mut at) = (sum, 0);
    for s in 1..=n - win {
        sum += cols[s + win - 1] - cols[s - 1];
        // prefer the window nearer the middle on ties (sums carry rounding)
        let middle = |s: usize| (s as f64 - (n - win) as f64 / 2.0).abs();
        if sum > best + 1e-4 || ((sum - best).abs() <= 1e-4 && middle(s) < middle(at)) {
            best = sum;
            at = s;
        }
    }
    Some(if n == win { 0.5 } else { at as f64 / (n - win) as f64 })
}

/// Mean absolute luma difference of two equal thumbnails, 0..1.
pub fn difference(a: &GrayImage, b: &GrayImage) -> f32 {
    let n = a.as_raw().len().max(1) as f32;
    a.as_raw().iter().zip(b.as_raw()).map(|(x, y)| (*x as f32 - *y as f32).abs()).sum::<f32>() / (255.0 * n)
}

/// The focus path from samples `(t, focus)` and cut times, over a clip `duration` seconds long.
pub fn path(samples: &[(f64, Option<f64>)], cuts: &[f64], duration: f64) -> Vec<Segment> {
    let mut bounds = vec![0.0];
    bounds.extend(cuts.iter().copied().filter(|c| *c > 0.0 && *c < duration));
    bounds.push(duration);
    let mut out = Vec::new();
    for pair in bounds.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        let shot: Vec<(f64, f64)> = samples
            .iter()
            .filter(|(t, _)| *t >= start && *t < end)
            .filter_map(|(t, f)| f.map(|f| (*t, f)))
            .collect();
        if shot.is_empty() {
            out.push(Segment { start, end, keys: vec![(start, 0.5)] });
            continue;
        }
        let mut sorted: Vec<f64> = shot.iter().map(|s| s.1).collect();
        sorted.sort_by(f64::total_cmp);
        let median = sorted[sorted.len() / 2];
        let spread = sorted[sorted.len() * 9 / 10] - sorted[sorted.len() / 10];
        if spread < DEAD_ZONE * 1.5 {
            // a still shot: one position, no drift
            out.push(Segment { start, end, keys: vec![(start, median)] });
            continue;
        }
        // a moving subject: hold inside a dead zone, then ease toward where they went
        let mut keys = vec![(start, shot[0].1)];
        let mut held = shot[0].1;
        for (i, &(t, _)) in shot.iter().enumerate() {
            let lo = i.saturating_sub(2);
            let mut near: Vec<f64> = shot[lo..(i + 3).min(shot.len())].iter().map(|s| s.1).collect();
            near.sort_by(f64::total_cmp);
            let target = near[near.len() / 2];
            if (target - held).abs() > DEAD_ZONE {
                held += (target - held) * 0.6;
                keys.push((t.max(start), held));
            }
        }
        out.push(Segment { start, end, keys });
    }
    out
}

/// Samples a clip: a focus every `every` frames and the cut times, for windows of `out_aspect`.
pub fn track_video(path: &Path, matter: &Matter, out_aspect: f64, mut progress: impl FnMut(u32, u32)) -> Result<(Vec<Segment>, f64)> {
    let info = video_info(path).with_context(|| format!("cannot read {}", path.display()))?;
    let fps = info.fps.max(1.0);
    let every = ((fps / 5.0).round() as u32).max(1);
    let mut samples = Vec::new();
    let mut cuts = Vec::new();
    let mut prev: Option<GrayImage> = None;
    let mut k = 1.0;
    let mut i = 0u32;
    for_each_video_frame(path, |frame| {
        let t = i as f64 / fps;
        let thumb = thumbnail(&frame.rgba, frame.width, frame.height);
        let cut = prev.as_ref().is_some_and(|p| difference(p, &thumb) > CUT);
        if cut {
            cuts.push(t);
        }
        prev = Some(thumb);
        if i % every == 0 || cut {
            k = window(frame.width, frame.height, out_aspect);
            let rgb = RgbImage::from_fn(frame.width, frame.height, |x, y| {
                let p = ((y * frame.width + x) * 4) as usize;
                image::Rgb([frame.rgba[p], frame.rgba[p + 1], frame.rgba[p + 2]])
            });
            let mask = matter.mask(&rgb, 128, (128 * frame.height / frame.width).max(1))?;
            samples.push((t, best_focus(&columns(&mask), k)));
        }
        i += 1;
        progress(i, info.frames);
        Ok(())
    })?;
    if i == 0 {
        bail!("no frames in {}", path.display());
    }
    Ok((path_or_centre(&samples, &cuts, i as f64 / fps, k), k))
}

fn path_or_centre(samples: &[(f64, Option<f64>)], cuts: &[f64], duration: f64, k: f64) -> Vec<Segment> {
    if k >= 1.0 { Vec::new() } else { path(samples, cuts, duration) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cols_with(n: usize, people: &[(usize, usize)]) -> Vec<f32> {
        (0..n).map(|x| if people.iter().any(|&(a, b)| x >= a && x < b) { 0.8 } else { 0.0 }).collect()
    }

    #[test]
    fn sizes_the_window_for_the_output_shape() {
        assert!((window(1920, 1080, 9.0 / 16.0) - 0.31640625).abs() < 1e-9);
        assert_eq!(window(1080, 1920, 9.0 / 16.0), 1.0);
    }

    #[test]
    fn puts_the_window_on_the_person() {
        // 100 columns, window 30: a person at 70..85 -> window 62..92 or so, focus near 0.9
        let f = best_focus(&cols_with(100, &[(70, 85)]), 0.3).unwrap();
        let start = f * 70.0;
        assert!(start <= 70.0 && start + 30.0 >= 85.0, "{f}");
        // nobody: no opinion
        assert_eq!(best_focus(&cols_with(100, &[]), 0.3), None);
        // two people far apart: the window lands on one of them, not the empty middle
        let f = best_focus(&cols_with(100, &[(5, 20), (78, 96)]), 0.3).unwrap();
        let start = f * 70.0;
        let covers = |a: f64, b: f64| start <= a && start + 30.0 >= b;
        assert!(covers(5.0, 20.0) || covers(78.0, 96.0), "landed between them: {f}");
    }

    #[test]
    fn holds_a_still_shot_and_jumps_at_cuts() {
        let mut samples: Vec<(f64, Option<f64>)> = (0..20).map(|i| (i as f64 * 0.2, Some(0.40 + (i % 3) as f64 * 0.01))).collect();
        samples.extend((20..40).map(|i| (i as f64 * 0.2, Some(0.85))));
        let p = path(&samples, &[4.0], 8.0);
        assert_eq!(p.len(), 2);
        assert_eq!((p[0].start, p[0].end, p[0].keys.len()), (0.0, 4.0, 1));
        assert!((p[0].keys[0].1 - 0.41).abs() < 0.011, "{:?}", p[0].keys);
        assert_eq!((p[1].start, p[1].keys[0]), (4.0, (4.0, 0.85)));
    }

    #[test]
    fn follows_a_person_who_walks_across() {
        let samples: Vec<(f64, Option<f64>)> = (0..30).map(|i| (i as f64 * 0.2, Some(0.1 + i as f64 * 0.025))).collect();
        let p = path(&samples, &[], 6.0);
        assert_eq!(p.len(), 1);
        let keys = &p[0].keys;
        assert!(keys.len() > 3, "{keys:?}");
        assert!(keys.windows(2).all(|w| w[1].1 >= w[0].1), "moves one way: {keys:?}");
        assert!(keys.last().unwrap().1 > 0.6);
    }

    #[test]
    fn centres_a_shot_with_nobody_in_it() {
        let p = path(&[(0.0, None), (0.2, None)], &[], 1.0);
        assert_eq!(p, vec![Segment { start: 0.0, end: 1.0, keys: vec![(0.0, 0.5)] }]);
    }

    #[test]
    fn ignores_faint_alpha_on_scenery() {
        let faint = GrayImage::from_pixel(10, 10, image::Luma([60]));
        assert!(columns(&faint).iter().all(|c| *c == 0.0));
        let solid = GrayImage::from_fn(10, 10, |x, _| image::Luma([if x == 3 { 255 } else { 0 }]));
        assert_eq!(columns(&solid)[3], 1.0);
    }

    #[test]
    fn thumbnails_average_the_frame() {
        let mut rgba = vec![0u8; 64 * 36 * 4];
        for p in rgba.chunks_mut(4) {
            p.copy_from_slice(&[200, 200, 200, 255]);
        }
        let t = thumbnail(&rgba, 64, 36);
        assert_eq!(t.dimensions(), (32, 18));
        assert!(t.pixels().all(|p| (p[0] as i32 - 199).abs() <= 2), "{:?}", t.get_pixel(0, 0));
    }

    #[test]
    fn spots_a_cut_between_different_pictures() {
        let a = GrayImage::from_pixel(32, 18, image::Luma([40]));
        let b = GrayImage::from_pixel(32, 18, image::Luma([200]));
        assert!(difference(&a, &b) > CUT);
        assert!(difference(&a, &a) < 0.001);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reframed {
    pub id: String,
    /// Crop width as a share of the picture's width
    pub window: f64,
    pub shots: usize,
    pub moves: usize,
    pub timing: String,
}

/// `9:16` -> 0.5625
pub fn parse_aspect(s: &str) -> Result<f64> {
    let (w, h) = s.split_once(':').context("aspect looks like 9:16")?;
    let (w, h): (f64, f64) = (w.trim().parse()?, h.trim().parse()?);
    if !(w > 0.0 && h > 0.0) {
        bail!("aspect {s} must be two positive numbers");
    }
    Ok(w / h)
}

/// Tracks the speaker in clip `id` (made by `video_clip`) and stores the path in its timing, so
/// `clipVideo` keeps them in frame at `aspect`.
pub async fn reframe(root: std::path::PathBuf, id: String, aspect: f64, on_status: impl Fn(&str) + Send + 'static) -> Result<Reframed> {
    let timing_rel = format!("assets/audio/vo/{id}.timing.json");
    let timing_path = root.join(&timing_rel);
    let mut timing: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&timing_path).with_context(|| format!("no clip \"{id}\" ({timing_rel}); cut it with video_clip first"))?,
    )?;
    let video = timing["clip"]["video"].as_str().with_context(|| format!("\"{id}\" is not a clip; cut one with video_clip"))?.to_string();
    let weights = super::ensure_weights(|m| on_status(m)).await?;
    let path = root.join(&video);
    let (segments, k) = tokio::task::spawn_blocking(move || {
        let matter = Matter::load(&weights, super::Quality::Fast)?;
        track_video(&path, &matter, aspect, |_, _| {})
    })
    .await
    .map_err(|e| anyhow::anyhow!("tracking stopped: {e}"))??;
    let focus: Vec<serde_json::Value> = segments
        .iter()
        .map(|s| {
            let r = |x: f64| (x * 1000.0).round() / 1000.0;
            serde_json::json!({ "start": r(s.start), "end": r(s.end), "keys": s.keys.iter().map(|(t, f)| [r(*t), r(*f)]).collect::<Vec<_>>() })
        })
        .collect();
    timing["clip"]["focus"] = focus.into();
    std::fs::write(&timing_path, serde_json::to_string_pretty(&timing)?)?;
    Ok(Reframed {
        id,
        window: (k * 1000.0).round() / 1000.0,
        shots: segments.len(),
        moves: segments.iter().map(|s| s.keys.len().saturating_sub(1)).sum(),
        timing: timing_rel,
    })
}
