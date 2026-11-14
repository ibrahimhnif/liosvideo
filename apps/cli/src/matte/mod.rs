//! Cut-outs for `video({ matte: true })`: MODNet portrait matting (Apache-2.0) run on the GPU through
//! Burn + wgpu, written as one H.264 MP4 that every renderer already decodes.
//!
//! Packed layout (`<name>.matte.mp4`): the picture fills the top 2/3 of each frame and its mask, at
//! half the height, fills the bottom 1/3 (white = keep). The quad shader's packed mode
//! (gpu/shaders/quad.wgsl, mode 3) reads both halves and cuts the picture out.
//!
//! The model runs once per clip, when the cut-out is made; renders only read the file. Weights
//! (26 MB) download on first use into the user cache and are checked against WEIGHTS_SHA256.

#[allow(clippy::all, unused)]
mod modnet;

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{anyhow, bail, Context, Result};
use burn::backend::wgpu::{Wgpu, WgpuDevice};
use burn::tensor::{Tensor, TensorData};
use burn_store::{BurnpackStore, ModuleSnapshot};
use image::{imageops::FilterType, GrayImage, ImageBuffer, Luma, RgbImage};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::assets::{for_each_video_frame, video_info};
use crate::media::encoder::{Mp4Encoder, VideoEncoderKind};

type B = Wgpu;

/// Burnpack weights for `modnet.rs` (converted from MODNet's ONNX export by burn-onnx 0.21).
pub const WEIGHTS_URL: &str =
    "https://github.com/ibrahimhnif/liosvideo/releases/download/model-modnet-v1/modnet-v1.bpk";
pub const WEIGHTS_SHA256: &str = "aa317fb1d0e15603fb1d2e201db89757639d3c82804ff039a051f70f6add6e0e";
const WEIGHTS_FILE: &str = "modnet-v1.bpk";

/// How finely the model sees each frame (its input's short side). The mask is upscaled to the
/// frame either way; outlines and cut-outs look the same at `fast`, hair edges improve at `best`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    /// 256 px: about 25 frames a second on an M4
    Fast,
    /// 384 px
    Balanced,
    /// 512 px, MODNet's own size: about 6 frames a second on an M4
    Best,
}

impl Quality {
    pub fn parse(s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "fast" => Ok(Self::Fast),
            "balanced" => Ok(Self::Balanced),
            "best" => Ok(Self::Best),
            other => bail!("Unknown quality '{other}'. Use one of: fast, balanced, best"),
        }
    }

    fn short_side(self) -> f32 {
        match self {
            Self::Fast => 256.0,
            Self::Balanced => 384.0,
            Self::Best => 512.0,
        }
    }
}

/// The packed cut-out next to a video: `dir/name.matte.mp4` (same rule as the runtime's `mattePath`).
pub fn matte_path(src: &str) -> String {
    if src.ends_with(".matte.mp4") {
        return src.to_string();
    }
    let slash = src.rfind('/').map_or(0, |i| i + 1);
    let stem = match src.rfind('.') {
        Some(dot) if dot > slash => &src[..dot],
        _ => src,
    };
    format!("{stem}.matte.mp4")
}

/// Picture size kept in the packed file: an even width, and a height that is a multiple of 4 so
/// the half-height mask is even too (H.264 needs even sizes). Crops at most 1 column and 3 rows.
pub fn packed_size(width: u32, height: u32) -> (u32, u32) {
    (width & !1, height & !3)
}

/// The model's input size: the short side at `short`, both sides multiples of 32.
pub fn model_size(width: u32, height: u32, short: f32) -> (u32, u32) {
    let scale = short / width.min(height).max(1) as f32;
    let round = |v: u32| (((v as f32 * scale) / 32.0).round() as u32).max(1) * 32;
    (round(width), round(height))
}

/// One packed frame (RGBA, opaque): `picture` (w × h RGB) on top, `mask` (w × h/2) below as grey.
pub fn pack_frame(picture: &RgbImage, mask: &GrayImage) -> Vec<u8> {
    let (w, h) = picture.dimensions();
    let mh = h / 2;
    debug_assert_eq!(mask.dimensions(), (w, mh));
    let mut out = vec![255u8; (w * (h + mh) * 4) as usize];
    for (i, p) in picture.pixels().enumerate() {
        out[i * 4..i * 4 + 3].copy_from_slice(&p.0);
    }
    let offset = (w * h) as usize;
    for (i, m) in mask.pixels().enumerate() {
        let o = (offset + i) * 4;
        out[o..o + 3].fill(m.0[0]);
    }
    out
}

pub fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("liosvideo")
        .join("models")
}

fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

/// The weights file: `LIOSVIDEO_MODNET` if set, else the cached download (fetched and checked
/// the first time).
pub async fn ensure_weights(mut progress: impl FnMut(&str)) -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("LIOSVIDEO_MODNET") {
        return Ok(PathBuf::from(path));
    }
    let path = cache_dir().join(WEIGHTS_FILE);
    if path.exists() && sha256_file(&path)? == WEIGHTS_SHA256 {
        return Ok(path);
    }
    progress("Downloading the MODNet model (26 MB, once)…");
    let response = reqwest::get(WEIGHTS_URL)
        .await
        .and_then(|r| r.error_for_status())
        .with_context(|| format!("could not download the matting model from {WEIGHTS_URL}"))?;
    let bytes = response.bytes().await.context("matting model download interrupted")?;
    let got = format!("{:x}", Sha256::digest(&bytes));
    if got != WEIGHTS_SHA256 {
        bail!("the downloaded matting model is corrupt (sha256 {got}); try again");
    }
    std::fs::create_dir_all(cache_dir())?;
    let part = path.with_extension("bpk.part");
    std::fs::write(&part, &bytes)?;
    std::fs::rename(&part, &path)?;
    Ok(path)
}

/// MODNet on the GPU.
pub struct Matter {
    model: modnet::Model<B>,
    device: WgpuDevice,
    short: f32,
}

impl Matter {
    pub fn load(weights: &Path, quality: Quality) -> Result<Self> {
        let device = WgpuDevice::default();
        let mut model = modnet::Model::<B>::new(&device);
        let mut store = BurnpackStore::from_file(weights);
        model
            .load_from(&mut store)
            .map_err(|e| anyhow!("could not load the matting model {}: {e:?}", weights.display()))?;
        Ok(Self {
            model,
            device,
            short: quality.short_side(),
        })
    }

    /// Alpha (0 background … 255 subject) for `picture`, at `out_w` × `out_h`.
    pub fn mask(&self, picture: &RgbImage, out_w: u32, out_h: u32) -> Result<GrayImage> {
        let (mw, mh) = model_size(picture.width(), picture.height(), self.short);
        let small = image::imageops::resize(picture, mw, mh, FilterType::Triangle);
        let (w, h) = (mw as usize, mh as usize);
        let mut data = vec![0f32; 3 * w * h];
        for (x, y, p) in small.enumerate_pixels() {
            for c in 0..3 {
                data[c * w * h + y as usize * w + x as usize] = p[c] as f32 / 127.5 - 1.0;
            }
        }
        let input = Tensor::<B, 4>::from_data(TensorData::new(data, [1, 3, h, w]), &self.device);
        let values: Vec<f32> = self
            .model
            .forward(input)
            .into_data()
            .to_vec()
            .map_err(|e| anyhow!("matting output: {e:?}"))?;
        let alpha: GrayImage = ImageBuffer::from_fn(mw, mh, |x, y| {
            Luma([(values[(y * mw + x) as usize].clamp(0.0, 1.0) * 255.0).round() as u8])
        });
        Ok(image::imageops::resize(&alpha, out_w, out_h, FilterType::Triangle))
    }
}

#[derive(Debug, Clone, Copy)]
pub struct MatteOptions {
    pub quality: Quality,
    /// make it again even when the cut-out exists
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Matted {
    /// the packed cut-out, project-relative
    pub rel_path: String,
    pub frames: u32,
    pub width: u32,
    pub height: u32,
    pub seconds: f64,
    /// false when an existing cut-out was kept
    pub made: bool,
    pub usage: String,
}

fn usage(src: &str) -> String {
    format!(
        "video({{ src: \"{src}\", matte: true, ... }}) plays the cut-out; wrap it in group({{ sticker: 8 }}) for a sticker outline"
    )
}

/// Makes `<src stem>.matte.mp4` for the project video `src`. Blocking: run it off the async runtime.
pub fn matte_video(
    root: &Path,
    src: &str,
    weights: &Path,
    opts: MatteOptions,
    mut progress: impl FnMut(u32, u32),
) -> Result<Matted> {
    let src_path = root.join(src);
    if !src_path.exists() {
        bail!("video not found: {src}");
    }
    let rel = matte_path(src);
    if rel == src {
        bail!("{src} is already a cut-out");
    }
    let out_path = root.join(&rel);
    let info = video_info(&src_path).with_context(|| format!("cannot read {src} (MP4 with H.264 is supported)"))?;
    if out_path.exists() && !opts.force {
        let packed = video_info(&out_path).ok();
        return Ok(Matted {
            rel_path: rel,
            frames: packed.map_or(0, |p| p.frames),
            width: 0,
            height: 0,
            seconds: 0.0,
            made: false,
            usage: usage(src),
        });
    }

    let started = Instant::now();
    let matter = Matter::load(weights, opts.quality)?;
    let part = out_path.with_extension("mp4.part");
    let mut encoder: Option<Mp4Encoder> = None;
    let mut size = (0, 0);
    let mut done = 0;
    let frames = for_each_video_frame(&src_path, |frame| {
        let (w, h) = packed_size(frame.width, frame.height);
        if w < 32 || h < 32 {
            bail!("{src} is too small to cut out ({}×{})", frame.width, frame.height);
        }
        let picture = RgbImage::from_fn(w, h, |x, y| {
            let i = ((y * frame.width + x) * 4) as usize;
            image::Rgb([frame.rgba[i], frame.rgba[i + 1], frame.rgba[i + 2]])
        });
        let mask = matter.mask(&picture, w, h / 2)?;
        if encoder.is_none() {
            size = (w, h);
            // generous bitrate: the picture is re-encoded once, and the mask's edges must stay clean
            let bitrate = ((w as f64 * h as f64 * 1.5 * info.fps * 0.2) as u32).clamp(4_000_000, 60_000_000);
            encoder = Some(Mp4Encoder::new_with_encoder(
                &part,
                w,
                h + h / 2,
                info.fps,
                48_000,
                bitrate,
                128_000,
                VideoEncoderKind::Auto,
            )?);
        }
        encoder.as_mut().unwrap().push_frame(&pack_frame(&picture, &mask))?;
        done += 1;
        progress(done, info.frames);
        Ok(())
    });
    let frames = match frames {
        Ok(n) => n,
        Err(e) => {
            drop(encoder);
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
    };
    encoder.ok_or_else(|| anyhow!("no frames in {src}"))?.finish()?;
    std::fs::rename(&part, &out_path).with_context(|| format!("could not write {rel}"))?;
    Ok(Matted {
        rel_path: rel,
        frames,
        width: size.0,
        height: size.1,
        seconds: started.elapsed().as_secs_f64(),
        made: true,
        usage: usage(src),
    })
}

/// Fetches the weights if needed and makes the cut-out off the async runtime (CLI and MCP).
pub async fn make(
    root: PathBuf,
    src: String,
    opts: MatteOptions,
    on_status: impl Fn(&str) + Send + 'static,
    on_progress: impl FnMut(u32, u32) + Send + 'static,
) -> Result<Matted> {
    let weights = ensure_weights(|m| on_status(m)).await?;
    tokio::task::spawn_blocking(move || matte_video(&root, &src, &weights, opts, on_progress))
        .await
        .map_err(|e| anyhow!("matting stopped: {e}"))?
}

/// A project-relative path for `video`: given relative to the project, or an absolute path inside it.
pub fn project_relative(root: &Path, video: &str) -> Result<String> {
    let path = Path::new(video);
    if path.is_absolute() {
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let full = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let rel = full
            .strip_prefix(&root)
            .map_err(|_| anyhow!("{video} is outside the project; copy it into assets/video/ first"))?;
        return Ok(rel.to_string_lossy().replace('\\', "/"));
    }
    Ok(video.trim_start_matches("./").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_cut_out_like_the_runtime() {
        assert_eq!(matte_path("assets/video/talk.mp4"), "assets/video/talk.matte.mp4");
        assert_eq!(matte_path("clip.final.mov"), "clip.final.matte.mp4");
        assert_eq!(matte_path("assets/video/talk.matte.mp4"), "assets/video/talk.matte.mp4");
        assert_eq!(matte_path("assets/v.1/clip"), "assets/v.1/clip.matte.mp4");
    }

    #[test]
    fn packed_sizes_keep_the_mask_height_even() {
        assert_eq!(packed_size(1920, 1080), (1920, 1080));
        assert_eq!(packed_size(1081, 1078), (1080, 1076));
        let (_, h) = packed_size(720, 1282);
        assert_eq!((h / 2) % 2, 0);
    }

    #[test]
    fn model_input_keeps_the_aspect_on_a_32_grid() {
        assert_eq!(model_size(1920, 1080, 256.0), (448, 256));
        assert_eq!(model_size(1920, 1080, 512.0), (896, 512));
        assert_eq!(model_size(1080, 1920, 256.0), (256, 448));
    }

    #[test]
    fn packs_the_picture_over_its_half_height_mask() {
        let picture = RgbImage::from_pixel(4, 4, image::Rgb([10, 20, 30]));
        let mask = GrayImage::from_fn(4, 2, |x, _| Luma([if x < 2 { 255 } else { 0 }]));
        let out = pack_frame(&picture, &mask);
        assert_eq!(out.len(), 4 * 6 * 4);
        assert_eq!(&out[0..4], &[10, 20, 30, 255]);
        let row4 = 4 * 4 * 4;
        assert_eq!(&out[row4..row4 + 4], &[255, 255, 255, 255]);
        assert_eq!(&out[row4 + 12..row4 + 16], &[0, 0, 0, 255]);
    }

    #[test]
    fn takes_videos_relative_to_the_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets/video")).unwrap();
        std::fs::write(dir.path().join("assets/video/a.mp4"), b"").unwrap();
        assert_eq!(project_relative(dir.path(), "./assets/video/a.mp4").unwrap(), "assets/video/a.mp4");
        let abs = dir.path().join("assets/video/a.mp4");
        assert_eq!(project_relative(dir.path(), abs.to_str().unwrap()).unwrap(), "assets/video/a.mp4");
        assert!(project_relative(dir.path(), "/elsewhere/b.mp4").is_err());
    }

    #[test]
    fn parses_quality() {
        assert_eq!(Quality::parse("Fast").unwrap(), Quality::Fast);
        assert_eq!(Quality::parse("best").unwrap(), Quality::Best);
        assert!(Quality::parse("ultra").is_err());
    }

    /// Needs the weights (LIOSVIDEO_MODNET=path, or a network download) and a GPU:
    /// `cargo test -p liosvideo-cli matte -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn cuts_a_person_out_of_a_clip() {
        let weights = ensure_weights(|m| eprintln!("{m}")).await.unwrap();
        let clip = std::env::var("LIOSVIDEO_MATTE_CLIP").expect("set LIOSVIDEO_MATTE_CLIP to an mp4 of a person");
        let dir = tempfile::tempdir().unwrap();
        std::fs::copy(&clip, dir.path().join("clip.mp4")).unwrap();
        let out = matte_video(dir.path(), "clip.mp4", &weights, MatteOptions { quality: Quality::Fast, force: false }, |_, _| {})
            .unwrap();
        assert!(out.made);
        assert!(dir.path().join(&out.rel_path).exists());
        let info = video_info(&dir.path().join(&out.rel_path)).unwrap();
        assert_eq!(info.frames, out.frames);
    }
}
