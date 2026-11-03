// Asset loading for the headless renderer.
//
// Desktop feeds `ImageBitmap`s produced by the WebView. The CLI decodes files
// directly: raster images via `image`, SVGs via `resvg`, and video frames via
// MP4 demux + OpenH264 decode (frame-accurate at `VideoItem.time`).

use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use mp4::{Mp4Reader, TrackType};
use openh264::decoder::Decoder;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct ImageAsset {
    pub width: u32,
    pub height: u32,
    /// Premultiplied RGBA, ready for `queue.write_texture`.
    pub rgba: Vec<u8>,
}

pub struct AssetStore {
    root: PathBuf,
    images: HashMap<String, Option<Arc<ImageAsset>>>,
    videos: HashMap<String, Option<VideoState>>,
    warned: HashMap<String, ()>,
}

impl AssetStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            images: HashMap::new(),
            videos: HashMap::new(),
            warned: HashMap::new(),
        }
    }

    pub fn image(&mut self, src: &str) -> Option<Arc<ImageAsset>> {
        if let Some(cached) = self.images.get(src) {
            return cached.clone();
        }

        let loaded = match resolve(&self.root, src) {
            Some(path) => match decode_image(&path) {
                Ok(asset) => Some(Arc::new(asset)),
                Err(err) => {
                    self.warn_once(src, &format!("missing image asset \"{src}\": {err}"));
                    None
                }
            },
            None => {
                self.warn_once(src, &format!("missing image asset \"{src}\""));
                None
            }
        };

        self.images.insert(src.to_string(), loaded.clone());
        loaded
    }

    pub fn video_frame(&mut self, src: &str, time: f64) -> Option<Arc<ImageAsset>> {
        if !self.videos.contains_key(src) {
            let state = resolve(&self.root, src).and_then(|path| VideoState::open(&path).ok());
            self.videos.insert(src.to_string(), state);
        }

        let Some(Some(state)) = self.videos.get_mut(src) else {
            self.warn_once(
                src,
                &format!("missing or unsupported video asset \"{src}\""),
            );
            return None;
        };

        match state.frame_at(time) {
            Ok(frame) => frame,
            Err(err) => {
                self.warn_once(src, &format!("failed to decode video \"{src}\": {err}"));
                None
            }
        }
    }

    fn warn_once(&mut self, src: &str, message: &str) {
        if self.warned.insert(src.to_string(), ()).is_none() {
            eprintln!("Warning: {message}");
        }
    }
}

fn resolve(root: &Path, src: &str) -> Option<PathBuf> {
    let path = if Path::new(src).is_absolute() {
        PathBuf::from(src)
    } else {
        root.join(src)
    };
    path.is_file().then_some(path)
}

fn decode_image(path: &Path) -> Result<ImageAsset> {
    let bytes =
        std::fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "svg" || ext == "svgz" || looks_like_svg(&bytes) {
        return decode_svg(&bytes);
    }

    let image = image::load_from_memory(&bytes)
        .with_context(|| format!("unsupported image format for {}", path.display()))?;
    let mut rgba = image.to_rgba8();
    premultiply(rgba.as_mut());
    Ok(ImageAsset {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
    })
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(512)];
    let text = String::from_utf8_lossy(head);
    let trimmed = text.trim_start();
    trimmed.starts_with("<svg") || trimmed.starts_with("<?xml")
}

fn decode_svg(bytes: &[u8]) -> Result<ImageAsset> {
    let options = resvg::usvg::Options::default();
    let tree =
        resvg::usvg::Tree::from_data(bytes, &options).map_err(|e| anyhow!("invalid SVG: {e}"))?;
    let size = tree.size();
    let width = size.width().ceil().max(1.0) as u32;
    let height = size.height().ceil().max(1.0) as u32;

    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| anyhow!("failed to allocate {width}x{height} SVG pixmap"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::default(),
        &mut pixmap.as_mut(),
    );

    // tiny-skia stores premultiplied RGBA, matching the desktop upload path.
    Ok(ImageAsset {
        width,
        height,
        rgba: pixmap.take(),
    })
}

fn premultiply(rgba: &mut [u8]) {
    for pixel in rgba.chunks_exact_mut(4) {
        let a = pixel[3] as u32;
        if a == 255 {
            continue;
        }
        for channel in &mut pixel[..3] {
            *channel = ((*channel as u32 * a) / 255) as u8;
        }
    }
}

struct VideoState {
    reader: Mp4Reader<BufReader<File>>,
    track_id: u32,
    timescale: u32,
    sps: Vec<u8>,
    pps: Vec<u8>,
    decoder: Option<Decoder>,
    next_sample: u32,
    sample_count: u32,
    last_decoded_ticks: u64,
    last_frame: Option<Arc<ImageAsset>>,
}

impl VideoState {
    fn open(path: &Path) -> Result<Self> {
        let file =
            File::open(path).with_context(|| format!("failed to open video {}", path.display()))?;
        let size = file.metadata()?.len();
        let reader = Mp4Reader::read_header(BufReader::new(file), size)
            .map_err(|e| anyhow!("invalid MP4: {e}"))?;

        let track = reader
            .tracks()
            .values()
            .find(|t| t.track_type().ok() == Some(TrackType::Video))
            .ok_or_else(|| anyhow!("no video track"))?;

        let track_id = track.track_id();
        let timescale = track.timescale();
        let sps = track
            .sequence_parameter_set()
            .map_err(|e| anyhow!("missing SPS: {e}"))?
            .to_vec();
        let pps = track
            .picture_parameter_set()
            .map_err(|e| anyhow!("missing PPS: {e}"))?
            .to_vec();
        let sample_count = reader.sample_count(track_id).unwrap_or(0);

        Ok(Self {
            reader,
            track_id,
            timescale: timescale.max(1),
            sps,
            pps,
            decoder: None,
            next_sample: 1,
            sample_count,
            last_decoded_ticks: 0,
            last_frame: None,
        })
    }

    fn reset(&mut self) {
        self.decoder = None;
        self.next_sample = 1;
        self.last_decoded_ticks = 0;
        self.last_frame = None;
    }

    fn ensure_decoder(&mut self) -> Result<&mut Decoder> {
        if self.decoder.is_none() {
            let mut decoder = Decoder::new().map_err(|e| anyhow!("h264 decoder: {e:?}"))?;
            let mut header = Vec::new();
            header.extend_from_slice(&[0, 0, 0, 1]);
            header.extend_from_slice(&self.sps);
            header.extend_from_slice(&[0, 0, 0, 1]);
            header.extend_from_slice(&self.pps);
            let _ = decoder.decode(&header);
            self.decoder = Some(decoder);
        }
        Ok(self.decoder.as_mut().unwrap())
    }

    fn frame_at(&mut self, time: f64) -> Result<Option<Arc<ImageAsset>>> {
        let target_ticks = (time.max(0.0) * self.timescale as f64).round() as u64;

        if target_ticks + 1 < self.last_decoded_ticks {
            self.reset();
        }

        if self.next_sample == 1
            && self.last_frame.is_some()
            && target_ticks <= self.last_decoded_ticks
        {
            return Ok(self.last_frame.clone());
        }

        while self.next_sample <= self.sample_count {
            let sample_id = self.next_sample;
            let Some(sample) = self
                .reader
                .read_sample(self.track_id, sample_id)
                .map_err(|e| anyhow!("failed to read sample {sample_id}: {e}"))?
            else {
                break;
            };

            let annexb = avcc_to_annexb(&sample.bytes);
            if !annexb.is_empty() {
                let decoder = self.ensure_decoder()?;
                if let Ok(Some(yuv)) = decoder.decode(&annexb) {
                    self.last_frame = Some(Arc::new(yuv_to_image(&yuv)));
                    self.last_decoded_ticks = sample.start_time;
                }
            }

            self.next_sample += 1;

            if sample.start_time > target_ticks {
                break;
            }
        }

        Ok(self.last_frame.clone())
    }
}

fn avcc_to_annexb(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 16);
    let mut i = 0usize;
    while i + 4 <= data.len() {
        let len = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]) as usize;
        i += 4;
        if len == 0 || i + len > data.len() {
            break;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&data[i..i + len]);
        i += len;
    }
    out
}

fn yuv_to_image(yuv: &openh264::decoder::DecodedYUV<'_>) -> ImageAsset {
    use openh264::formats::YUVSource;

    let (width, height) = yuv.dimensions();
    let mut rgb = vec![0u8; width * height * 3];
    yuv.write_rgb8(&mut rgb);

    let mut rgba = vec![255u8; width * height * 4];
    for i in 0..width * height {
        rgba[i * 4] = rgb[i * 3];
        rgba[i * 4 + 1] = rgb[i * 3 + 1];
        rgba[i * 4 + 2] = rgb[i * 3 + 2];
    }

    ImageAsset {
        width: width as u32,
        height: height as u32,
        rgba,
    }
}

/// Minimal `.timing.json` loader type shared with the runtime host.
#[derive(Debug, Clone, Deserialize)]
pub struct WordTimingFile {
    pub words: Vec<WordTimingFileWord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WordTimingFileWord {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premultiplies_rgba() {
        let mut data = vec![255, 128, 0, 128];
        premultiply(&mut data);
        assert_eq!(data[0], 128);
        assert_eq!(data[1], 64);
        assert_eq!(data[2], 0);
        assert_eq!(data[3], 128);
    }

    #[test]
    fn converts_avcc_lengths_to_annex_b() {
        let mut data = Vec::new();
        data.extend_from_slice(&3u32.to_be_bytes());
        data.extend_from_slice(&[1, 2, 3]);
        data.extend_from_slice(&2u32.to_be_bytes());
        data.extend_from_slice(&[4, 5]);
        let out = avcc_to_annexb(&data);
        assert_eq!(out, vec![0, 0, 0, 1, 1, 2, 3, 0, 0, 0, 1, 4, 5]);
    }

    #[test]
    fn decodes_svg_assets() {
        let dir = std::env::temp_dir().join(format!("liosvideo_svg_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("logo.svg");
        std::fs::write(
            &path,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff0000"/></svg>"##,
        )
        .unwrap();

        let image = decode_image(&path).unwrap();
        assert_eq!(image.width, 16);
        assert_eq!(image.height, 16);
        assert!(image.rgba[0] > 200);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
