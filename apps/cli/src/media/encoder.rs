use anyhow::{anyhow, Context, Result};
use fdk_aac_rs::encoder::{
    Aot, Bitrate, ChannelMode, Encoder as AacEncoder, EncoderError, Transport,
};
use mp4::{
    AacConfig, AudioObjectType, AvcConfig, ChannelConfig, FourCC, MediaConfig, Mp4Config,
    Mp4Sample, Mp4Writer, SampleFreqIndex, TrackConfig, TrackType,
};
use openh264::encoder::{Encoder as H264Encoder, EncoderConfig, FrameType, RateControlMode};
use openh264::formats::YUVBuffer;
use openh264::OpenH264API;
use std::io::{BufWriter, Cursor, Seek, Write};
use std::path::Path;

/// Timescale used for MP4 movie and video tracks (90 kHz standard)
pub const VIDEO_TIMESCALE: u32 = 90_000;

/// Which H.264 encoder writes the video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoEncoderKind {
    /// VideoToolbox on macOS, OpenH264 elsewhere or when VideoToolbox can't open a session
    #[default]
    Auto,
    /// VideoToolbox only (macOS); fails instead of falling back
    Hardware,
    /// OpenH264 on the CPU
    Software,
}

impl VideoEncoderKind {
    pub fn parse(s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "auto" => Ok(Self::Auto),
            "hardware" | "hw" | "videotoolbox" => Ok(Self::Hardware),
            "software" | "sw" | "openh264" => Ok(Self::Software),
            other => anyhow::bail!("Unknown encoder '{other}'. Use one of: auto, hardware, software"),
        }
    }
}

/// One encoded frame: AVCC NAL units (4-byte lengths, no SPS/PPS) and, on the first frame, the
/// parameter sets for the track header.
#[derive(Debug, Clone)]
pub struct EncodedVideo {
    pub avcc: Vec<u8>,
    pub sync: bool,
    pub params: Option<(Vec<u8>, Vec<u8>)>,
}

enum VideoBackend {
    OpenH264 {
        encoder: Box<H264Encoder>,
        yuv_scratch: Vec<u8>,
        last_payload: Option<Vec<u8>>,
    },
    #[cfg(target_os = "macos")]
    VideoToolbox(Box<super::videotoolbox::VtEncoder>),
}

/// Output target for MP4 muxer: either a file or an in-memory buffer.
pub enum Mp4Output {
    File(BufWriter<std::fs::File>),
    Cursor(Cursor<Vec<u8>>),
}

impl Write for Mp4Output {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::File(f) => f.write(buf),
            Self::Cursor(c) => c.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::File(f) => f.flush(),
            Self::Cursor(c) => c.flush(),
        }
    }
}

impl Seek for Mp4Output {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        match self {
            Self::File(f) => f.seek(pos),
            Self::Cursor(c) => c.seek(pos),
        }
    }
}

/// Convert 8-bit RGBA pixels into planar YUV420p (ITU-R BT.601 studio swing).
///
/// Planes layout in `yuv_out`:
/// - Y: `width * height`
/// - U: `(width / 2) * (height / 2)`
/// - V: `(width / 2) * (height / 2)`
/// - Total: `width * height * 3 / 2`
pub fn rgba_to_yuv420p(rgba: &[u8], width: usize, height: usize, yuv_out: &mut [u8]) {
    assert_eq!(width % 2, 0, "width must be even");
    assert_eq!(height % 2, 0, "height must be even");
    assert_eq!(rgba.len(), width * height * 4, "RGBA buffer size mismatch");
    let y_size = width * height;
    let uv_size = (width / 2) * (height / 2);
    assert_eq!(
        yuv_out.len(),
        y_size + 2 * uv_size,
        "YUV buffer size mismatch"
    );

    let (y_plane, uv_planes) = yuv_out.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    let half_width = width / 2;

    // Y plane pass: 1 Y sample per RGB pixel
    for row in 0..height {
        let rgba_row = &rgba[row * width * 4..(row + 1) * width * 4];
        let y_row = &mut y_plane[row * width..(row + 1) * width];

        for col in 0..width {
            let r = rgba_row[col * 4] as i32;
            let g = rgba_row[col * 4 + 1] as i32;
            let b = rgba_row[col * 4 + 2] as i32;

            // Rec.601 Y formula (studio swing): Y = 16 + (66*R + 129*G + 25*B + 128) >> 8
            let y = 16 + ((66 * r + 129 * g + 25 * b + 128) >> 8);
            y_row[col] = y.clamp(16, 235) as u8;
        }
    }

    // U/V planes pass: 1 U and 1 V sample per 2x2 RGB block
    for j in 0..(height / 2) {
        let row0 = j * 2;
        let row1 = row0 + 1;
        let rgba_row0 = &rgba[row0 * width * 4..(row0 + 1) * width * 4];
        let rgba_row1 = &rgba[row1 * width * 4..(row1 + 1) * width * 4];
        let u_row = &mut u_plane[j * half_width..(j + 1) * half_width];
        let v_row = &mut v_plane[j * half_width..(j + 1) * half_width];

        for i in 0..half_width {
            let col0 = i * 2;
            let col1 = col0 + 1;

            let r00 = rgba_row0[col0 * 4] as i32;
            let g00 = rgba_row0[col0 * 4 + 1] as i32;
            let b00 = rgba_row0[col0 * 4 + 2] as i32;

            let r01 = rgba_row0[col1 * 4] as i32;
            let g01 = rgba_row0[col1 * 4 + 1] as i32;
            let b01 = rgba_row0[col1 * 4 + 2] as i32;

            let r10 = rgba_row1[col0 * 4] as i32;
            let g10 = rgba_row1[col0 * 4 + 1] as i32;
            let b10 = rgba_row1[col0 * 4 + 2] as i32;

            let r11 = rgba_row1[col1 * 4] as i32;
            let g11 = rgba_row1[col1 * 4 + 1] as i32;
            let b11 = rgba_row1[col1 * 4 + 2] as i32;

            let avg_r = (r00 + r01 + r10 + r11 + 2) >> 2;
            let avg_g = (g00 + g01 + g10 + g11 + 2) >> 2;
            let avg_b = (b00 + b01 + b10 + b11 + 2) >> 2;

            // Rec.601 U/V formula (studio swing):
            // U = 128 + (-38*R - 74*G + 112*B + 128) >> 8
            // V = 128 + (112*R - 94*G - 18*B + 128) >> 8
            let u = 128 + ((-38 * avg_r - 74 * avg_g + 112 * avg_b + 128) >> 8);
            let v = 128 + ((112 * avg_r - 94 * avg_g - 18 * avg_b + 128) >> 8);

            u_row[i] = u.clamp(16, 240) as u8;
            v_row[i] = v.clamp(16, 240) as u8;
        }
    }
}

fn open_video(
    kind: VideoEncoderKind,
    width: u32,
    height: u32,
    fps: f64,
    bitrate: u32,
    keyframe_interval: usize,
) -> Result<VideoBackend> {
    #[cfg(target_os = "macos")]
    if kind != VideoEncoderKind::Software {
        match super::videotoolbox::VtEncoder::new(width, height, fps, bitrate.max(100_000), keyframe_interval) {
            Ok(vt) => return Ok(VideoBackend::VideoToolbox(Box::new(vt))),
            Err(e) if kind == VideoEncoderKind::Hardware => return Err(e),
            Err(e) => eprintln!("warning: {e}; encoding with OpenH264 instead"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    if kind == VideoEncoderKind::Hardware {
        anyhow::bail!("Hardware encoding (VideoToolbox) is only available on macOS; use --encoder software");
    }
    let _ = keyframe_interval;

    let api = OpenH264API::from_source();
    let config = EncoderConfig::new()
        .max_frame_rate(fps as f32)
        .rate_control_mode(RateControlMode::Bitrate)
        .set_bitrate_bps(bitrate.max(100_000))
        // Never skip: a skipped frame leaves a hole the MP4 can only fill by re-sending the
        // previous P-frame, which duplicates its frame_num and corrupts every frame after it.
        // Rate control raises QP instead.
        .enable_skip_frame(false)
        .debug(false);
    let encoder = H264Encoder::with_api_config(api, config)
        .map_err(|e| anyhow!("Failed to initialize OpenH264 encoder: {:?}", e))?;
    Ok(VideoBackend::OpenH264 {
        encoder: Box::new(encoder),
        yuv_scratch: vec![0u8; (width as usize * height as usize * 3) / 2],
        last_payload: None,
    })
}

fn encode_openh264(
    encoder: &mut H264Encoder,
    yuv_scratch: &mut [u8],
    last_payload: &mut Option<Vec<u8>>,
    rgba: &[u8],
    width: usize,
    height: usize,
    force_keyframe: bool,
) -> Result<EncodedVideo> {
    if force_keyframe {
        encoder.force_intra_frame();
    }
    rgba_to_yuv420p(rgba, width, height, yuv_scratch);
    let yuv_buffer = YUVBuffer::from_vec(yuv_scratch.to_vec(), width, height);
    let stream = encoder
        .encode(&yuv_buffer)
        .map_err(|e| anyhow!("H.264 encode frame error: {:?}", e))?;

    let mut sps: Option<Vec<u8>> = None;
    let mut pps: Option<Vec<u8>> = None;
    let mut payload = Vec::new();
    for l in 0..stream.num_layers() {
        let layer = stream.layer(l).unwrap();
        for n in 0..layer.nal_count() {
            let raw = strip_start_code(layer.nal_unit(n).unwrap());
            if raw.is_empty() {
                continue;
            }
            match raw[0] & 0x1F {
                7 => {
                    sps.get_or_insert_with(|| raw.to_vec());
                }
                8 => {
                    pps.get_or_insert_with(|| raw.to_vec());
                }
                // parameter sets live in the avcC track header; the sample holds the slices
                _ if layer.is_video() => {
                    payload.extend_from_slice(&(raw.len() as u32).to_be_bytes());
                    payload.extend_from_slice(raw);
                }
                _ => {}
            }
        }
    }
    let params = sps.zip(pps);
    let is_idr = stream.frame_type() == FrameType::IDR;
    if !payload.is_empty() {
        *last_payload = Some(payload.clone());
        Ok(EncodedVideo { avcc: payload, sync: is_idr, params })
    } else {
        // OpenH264 skipped this frame (skipping is disabled, so this should not happen); repeat
        // the last payload so the MP4 keeps a constant frame rate.
        Ok(EncodedVideo {
            avcc: last_payload.clone().unwrap_or_default(),
            sync: false,
            params,
        })
    }
}

/// An [`Mp4Encoder`] on its own thread, so encoding frame N overlaps rendering frame N+1. Frames
/// are encoded in the order they are pushed; at most `depth` wait in the queue.
enum EncoderMsg {
    Frame(Vec<u8>),
    Audio(Vec<f32>),
}

pub struct EncoderThread {
    tx: Option<std::sync::mpsc::SyncSender<EncoderMsg>>,
    handle: Option<std::thread::JoinHandle<Result<std::time::Duration>>>,
    name: &'static str,
}

impl EncoderThread {
    /// `open` runs on the encoder thread (OpenH264 sessions must stay on the thread that made them).
    pub fn spawn<F>(depth: usize, open: F) -> Result<Self>
    where
        F: FnOnce() -> Result<Mp4Encoder> + Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::sync_channel::<EncoderMsg>(depth.max(1));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<&'static str>>();
        let handle = std::thread::Builder::new()
            .name("liosvideo-encoder".into())
            .spawn(move || -> Result<std::time::Duration> {
                let mut encoder = match open() {
                    Ok(e) => {
                        let _ = ready_tx.send(Ok(e.encoder_name()));
                        e
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(anyhow!("{e:#}")));
                        return Err(e);
                    }
                };
                let mut busy = std::time::Duration::ZERO;
                while let Ok(msg) = rx.recv() {
                    let t = std::time::Instant::now();
                    match msg {
                        EncoderMsg::Frame(frame) => encoder.push_frame(&frame)?,
                        EncoderMsg::Audio(pcm) => encoder.push_audio(&pcm)?,
                    }
                    busy += t.elapsed();
                }
                let t = std::time::Instant::now();
                encoder.finish()?;
                Ok(busy + t.elapsed())
            })
            .context("Failed to start the encoder thread")?;
        let name = ready_rx
            .recv()
            .map_err(|_| anyhow!("The encoder thread stopped before it started"))??;
        Ok(Self { tx: Some(tx), handle: Some(handle), name })
    }

    pub fn encoder_name(&self) -> &'static str {
        self.name
    }

    /// Queues a frame; blocks only while `depth` frames are already waiting.
    pub fn push_frame(&mut self, rgba: Vec<u8>) -> Result<()> {
        self.send(EncoderMsg::Frame(rgba))
    }

    fn send(&mut self, msg: EncoderMsg) -> Result<()> {
        let sent = self.tx.as_ref().map(|tx| tx.send(msg).is_ok()).unwrap_or(false);
        if sent {
            Ok(())
        } else {
            // the thread stopped: report its error
            Err(self.join().err().unwrap_or_else(|| anyhow!("The encoder thread stopped early")))
        }
    }

    /// Adds the soundtrack (interleaved stereo; may be empty), encodes what is queued, writes the
    /// file and returns the time the encoder was busy.
    pub fn finish_with_audio(mut self, pcm: Vec<f32>) -> Result<std::time::Duration> {
        if !pcm.is_empty() {
            self.send(EncoderMsg::Audio(pcm))?;
        }
        self.join()
    }

    fn join(&mut self) -> Result<std::time::Duration> {
        self.tx.take();
        match self.handle.take() {
            Some(h) => h.join().map_err(|_| anyhow!("The encoder thread panicked"))?,
            None => Err(anyhow!("The encoder thread already stopped")),
        }
    }
}

/// Strip Annex B start code (`[0, 0, 0, 1]` or `[0, 0, 1]`) from a NAL unit.
fn strip_start_code(nal: &[u8]) -> &[u8] {
    if nal.len() >= 4 && nal[..4] == [0, 0, 0, 1] {
        &nal[4..]
    } else if nal.len() >= 3 && nal[..3] == [0, 0, 1] {
        &nal[3..]
    } else {
        nal
    }
}

/// Map audio sample rate to MP4 `SampleFreqIndex`.
fn sample_rate_to_freq_index(sample_rate: u32) -> SampleFreqIndex {
    match sample_rate {
        96000 => SampleFreqIndex::Freq96000,
        88200 => SampleFreqIndex::Freq88200,
        64000 => SampleFreqIndex::Freq64000,
        48000 => SampleFreqIndex::Freq48000,
        44100 => SampleFreqIndex::Freq44100,
        32000 => SampleFreqIndex::Freq32000,
        24000 => SampleFreqIndex::Freq24000,
        22050 => SampleFreqIndex::Freq22050,
        16000 => SampleFreqIndex::Freq16000,
        12000 => SampleFreqIndex::Freq12000,
        11025 => SampleFreqIndex::Freq11025,
        8000 => SampleFreqIndex::Freq8000,
        7350 => SampleFreqIndex::Freq7350,
        _ => SampleFreqIndex::Freq48000,
    }
}

/// Encode interleaved stereo float32 PCM samples into AAC-LC raw packets using `fdk-aac-rs`.
pub fn encode_pcm_to_aac(pcm: &[f32], sample_rate: u32, bitrate: u32) -> Result<Vec<Vec<u8>>> {
    if pcm.is_empty() {
        return Ok(Vec::new());
    }

    // Ensure even number of samples for stereo
    let stereo_len = pcm.len() - (pcm.len() % 2);
    let pcm = &pcm[..stereo_len];

    // Convert f32 [-1.0, 1.0] to i16 [-32768, 32767]
    let pcm_i16: Vec<i16> = pcm
        .iter()
        .map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            (clamped * 32767.0).round() as i16
        })
        .collect();

    let mut enc = AacEncoder::builder()
        .aot(Aot::AacLc)
        .sample_rate(sample_rate)
        .channel_mode(ChannelMode::Stereo)
        .bitrate(Bitrate::Cbr(bitrate.max(8_000)))
        .transport(Transport::Raw)
        .build()
        .map_err(|e| anyhow!("Failed to initialize AAC encoder: {:?}", e))?;

    let info = enc
        .info()
        .map_err(|e| anyhow!("Failed to query AAC encoder info: {:?}", e))?;

    let max_buf_size = std::cmp::max(info.max_out_buf_bytes() as usize, 4096);
    let mut out_buf = vec![0u8; max_buf_size];
    let mut packets = Vec::new();

    let mut input = &pcm_i16[..];
    while !input.is_empty() {
        let r = enc
            .encode(input, &mut out_buf)
            .map_err(|e| anyhow!("AAC encode error: {:?}", e))?;
        if r.out_bytes() > 0 {
            packets.push(out_buf[..r.out_bytes()].to_vec());
        }
        let consumed = r.in_samples();
        if consumed == 0 {
            break;
        }
        input = &input[consumed..];
    }

    // Flush encoder delay buffers
    loop {
        match enc.flush(&mut out_buf) {
            Ok(r) => {
                if r.out_bytes() > 0 {
                    packets.push(out_buf[..r.out_bytes()].to_vec());
                }
            }
            Err(EncoderError::EncodeEof) => break,
            Err(e) => return Err(anyhow!("AAC flush error: {:?}", e)),
        }
    }

    Ok(packets)
}

/// In-binary video encoder and MP4 muxer.
///
/// Encodes raw RGBA frames into H.264 via OpenH264 and mixes optional audio PCM
/// via FDK-AAC, muxing everything into an ISO MP4 container.
pub struct Mp4Encoder {
    width: u32,
    height: u32,
    fps: f64,
    sample_rate: u32,
    audio_bitrate: u32,
    frame_index: usize,
    samples_written: usize,
    keyframe_interval: usize,
    video: VideoBackend,
    pending_output: Option<Mp4Output>,
    mp4_writer: Option<Mp4Writer<Mp4Output>>,
    audio_pcm: Vec<f32>,
}

impl Mp4Encoder {
    /// Create a new `Mp4Encoder` writing to a file on disk, with the default encoder.
    pub fn new(
        out_path: &Path,
        width: u32,
        height: u32,
        fps: f64,
        sample_rate: u32,
        video_bitrate: u32,
        audio_bitrate: u32,
    ) -> Result<Self> {
        Self::new_with_encoder(
            out_path,
            width,
            height,
            fps,
            sample_rate,
            video_bitrate,
            audio_bitrate,
            VideoEncoderKind::Auto,
        )
    }

    /// Create a new `Mp4Encoder` writing to a file on disk with the chosen H.264 encoder.
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_encoder(
        out_path: &Path,
        width: u32,
        height: u32,
        fps: f64,
        sample_rate: u32,
        video_bitrate: u32,
        audio_bitrate: u32,
        kind: VideoEncoderKind,
    ) -> Result<Self> {
        if let Some(parent) = out_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).with_context(|| {
                    format!("Failed to create output directory: {}", parent.display())
                })?;
            }
        }
        let file = std::fs::File::create(out_path)
            .with_context(|| format!("Failed to create output MP4 file: {}", out_path.display()))?;
        Self::with_output(
            Mp4Output::File(BufWriter::new(file)),
            width,
            height,
            fps,
            sample_rate,
            video_bitrate,
            audio_bitrate,
            kind,
        )
    }

    /// Create an in-memory `Mp4Encoder` writing to a RAM buffer (ideal for unit testing).
    pub fn new_in_memory(width: u32, height: u32, fps: f64, sample_rate: u32) -> Result<Self> {
        Self::with_output(
            Mp4Output::Cursor(Cursor::new(Vec::new())),
            width,
            height,
            fps,
            sample_rate,
            10_000_000,
            192_000,
            VideoEncoderKind::Auto,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn with_output(
        output: Mp4Output,
        width: u32,
        height: u32,
        fps: f64,
        sample_rate: u32,
        video_bitrate: u32,
        audio_bitrate: u32,
        kind: VideoEncoderKind,
    ) -> Result<Self> {
        if width == 0 || height == 0 {
            anyhow::bail!("Width and height must be greater than zero");
        }
        if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            anyhow::bail!("Width and height must be even, got {}x{}", width, height);
        }
        if fps <= 0.0 {
            anyhow::bail!("FPS must be positive, got {}", fps);
        }

        // Keyframe every ~2 seconds (matches the desktop keyFrameInterval).
        let keyframe_interval = (fps * 2.0).round().max(1.0) as usize;
        let video = open_video(kind, width, height, fps, video_bitrate, keyframe_interval)?;

        Ok(Self {
            width,
            height,
            fps,
            sample_rate,
            audio_bitrate,
            frame_index: 0,
            samples_written: 0,
            keyframe_interval,
            video,
            pending_output: Some(output),
            mp4_writer: None,
            audio_pcm: Vec::new(),
        })
    }

    /// The encoder in use, for the render log.
    pub fn encoder_name(&self) -> &'static str {
        match &self.video {
            VideoBackend::OpenH264 { .. } => "OpenH264 (software)",
            #[cfg(target_os = "macos")]
            VideoBackend::VideoToolbox(vt) if vt.is_hardware() => "VideoToolbox (hardware)",
            #[cfg(target_os = "macos")]
            VideoBackend::VideoToolbox(_) => "VideoToolbox (software)",
        }
    }

    /// Push an 8-bit RGBA video frame (`width * height * 4` bytes).
    pub fn push_frame(&mut self, rgba_pixels: &[u8]) -> Result<()> {
        let expected_size = (self.width * self.height * 4) as usize;
        if rgba_pixels.len() != expected_size {
            anyhow::bail!(
                "Invalid RGBA frame size: expected {} bytes ({}x{}), got {}",
                expected_size,
                self.width,
                self.height,
                rgba_pixels.len()
            );
        }

        let keyframe = self.frame_index.is_multiple_of(self.keyframe_interval);
        let frames = match &mut self.video {
            VideoBackend::OpenH264 {
                encoder,
                yuv_scratch,
                last_payload,
            } => {
                let width = self.width as usize;
                let height = self.height as usize;
                vec![encode_openh264(
                    encoder,
                    yuv_scratch,
                    last_payload,
                    rgba_pixels,
                    width,
                    height,
                    keyframe && self.frame_index > 0,
                )?]
            }
            #[cfg(target_os = "macos")]
            VideoBackend::VideoToolbox(vt) => vt.encode(rgba_pixels, self.frame_index, keyframe)?,
        };
        self.frame_index += 1;
        for frame in frames {
            self.write_video(frame)?;
        }
        Ok(())
    }

    /// Muxes one encoded frame; the first one opens the MP4 and its video track.
    fn write_video(&mut self, frame: EncodedVideo) -> Result<()> {
        if self.mp4_writer.is_none() {
            let (sps, pps) = frame
                .params
                .clone()
                .ok_or_else(|| anyhow!("H.264 encoder failed to produce SPS/PPS parameter sets"))?;

            let output = self
                .pending_output
                .take()
                .ok_or_else(|| anyhow!("Output destination unavailable"))?;

            let mp4_config = Mp4Config {
                major_brand: FourCC::from(*b"isom"),
                minor_version: 512,
                compatible_brands: vec![
                    FourCC::from(*b"isom"),
                    FourCC::from(*b"iso2"),
                    FourCC::from(*b"avc1"),
                    FourCC::from(*b"mp41"),
                ],
                timescale: VIDEO_TIMESCALE,
            };

            let mut writer = Mp4Writer::write_start(output, &mp4_config)
                .map_err(|e| anyhow!("Failed to start MP4 container: {:?}", e))?;

            let avc_config = AvcConfig {
                width: self.width as u16,
                height: self.height as u16,
                seq_param_set: sps,
                pic_param_set: pps,
            };

            let video_track = TrackConfig {
                track_type: TrackType::Video,
                timescale: VIDEO_TIMESCALE,
                language: "und".to_string(),
                media_conf: MediaConfig::AvcConfig(avc_config),
            };

            writer
                .add_track(&video_track)
                .map_err(|e| anyhow!("Failed to add video track to MP4: {:?}", e))?;

            self.mp4_writer = Some(writer);
        }

        if frame.avcc.is_empty() {
            return Ok(());
        }
        let frame_duration = (VIDEO_TIMESCALE as f64 / self.fps).round() as u32;
        let start_time =
            (self.samples_written as f64 * VIDEO_TIMESCALE as f64 / self.fps).round() as u64;
        let sample = Mp4Sample {
            start_time,
            duration: frame_duration,
            rendering_offset: 0,
            is_sync: frame.sync,
            bytes: mp4::Bytes::from(frame.avcc),
        };
        let writer = self.mp4_writer.as_mut().unwrap();
        writer
            .write_sample(1, &sample)
            .map_err(|e| anyhow!("Failed to write video sample: {:?}", e))?;
        self.samples_written += 1;
        Ok(())
    }

    /// Push audio float32 PCM samples (interleaved stereo).
    pub fn push_audio(&mut self, pcm_samples: &[f32]) -> Result<()> {
        if !pcm_samples.is_empty() {
            self.audio_pcm.extend_from_slice(pcm_samples);
        }
        Ok(())
    }

    /// Flush encoder buffers and finalize the MP4 container (writes `moov` atom).
    pub fn finish(mut self) -> Result<()> {
        let mut output = self.finalize_container()?;
        output.flush()?;
        Ok(())
    }

    /// Finalize MP4 container and return the written bytes (for in-memory encoding).
    pub fn finish_to_buffer(mut self) -> Result<Vec<u8>> {
        let mut output = self.finalize_container()?;
        output.flush()?;
        match output {
            Mp4Output::Cursor(c) => Ok(c.into_inner()),
            Mp4Output::File(_) => anyhow::bail!("finish_to_buffer called on file-backed encoder"),
        }
    }

    fn finalize_container(&mut self) -> Result<Mp4Output> {
        if self.frame_index == 0 {
            anyhow::bail!("Cannot finalize MP4: no video frames were pushed");
        }
        #[cfg(target_os = "macos")]
        if let VideoBackend::VideoToolbox(vt) = &mut self.video {
            for frame in vt.finish()? {
                self.write_video(frame)?;
            }
        }
        if self.samples_written != self.frame_index {
            anyhow::bail!(
                "The encoder returned {} of {} frames",
                self.samples_written,
                self.frame_index
            );
        }

        let mut mp4_writer = self
            .mp4_writer
            .take()
            .ok_or_else(|| anyhow!("MP4 writer was not initialized"))?;

        // If audio samples were provided and sample_rate is valid, encode to AAC and mux audio track
        if !self.audio_pcm.is_empty() && self.sample_rate > 0 {
            let aac_config = AacConfig {
                bitrate: self.audio_bitrate,
                profile: AudioObjectType::AacLowComplexity,
                freq_index: sample_rate_to_freq_index(self.sample_rate),
                chan_conf: ChannelConfig::Stereo,
            };

            let audio_track = TrackConfig {
                track_type: TrackType::Audio,
                timescale: self.sample_rate,
                language: "und".to_string(),
                media_conf: MediaConfig::AacConfig(aac_config),
            };

            let audio_track_id = 2;
            mp4_writer
                .add_track(&audio_track)
                .map_err(|e| anyhow!("Failed to add audio track to MP4: {:?}", e))?;

            let aac_packets =
                encode_pcm_to_aac(&self.audio_pcm, self.sample_rate, self.audio_bitrate)?;
            let aac_frame_duration = 1024u32;
            let mut audio_start_time = 0u64;

            for packet in aac_packets {
                let sample = Mp4Sample {
                    start_time: audio_start_time,
                    duration: aac_frame_duration,
                    rendering_offset: 0,
                    is_sync: true,
                    bytes: mp4::Bytes::from(packet),
                };

                mp4_writer
                    .write_sample(audio_track_id, &sample)
                    .map_err(|e| anyhow!("Failed to write audio sample: {:?}", e))?;
                audio_start_time += aac_frame_duration as u64;
            }
        }

        // Finalize container: writes moov atom with updated mdat size and tracks
        mp4_writer
            .write_end()
            .map_err(|e| anyhow!("Failed to finalize MP4 container: {:?}", e))?;

        Ok(mp4_writer.into_writer())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rgba_to_yuv420p_conversion() {
        let width = 64;
        let height = 64;
        let mut rgba = vec![0u8; width * height * 4];

        // Fill with solid red: R=255, G=0, B=0, A=255
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = 255;
            pixel[1] = 0;
            pixel[2] = 0;
            pixel[3] = 255;
        }

        let mut yuv = vec![0u8; (width * height * 3) / 2];
        rgba_to_yuv420p(&rgba, width, height, &mut yuv);

        let y_size = width * height;
        let uv_size = (width / 2) * (height / 2);

        // Standard BT.601 Studio Red: Y ~ 82, U ~ 90, V ~ 240
        let avg_y = yuv[0..y_size].iter().map(|&v| v as u32).sum::<u32>() / y_size as u32;
        let avg_u = yuv[y_size..y_size + uv_size]
            .iter()
            .map(|&v| v as u32)
            .sum::<u32>()
            / uv_size as u32;
        let avg_v = yuv[y_size + uv_size..]
            .iter()
            .map(|&v| v as u32)
            .sum::<u32>()
            / uv_size as u32;

        assert!((75..=90).contains(&avg_y), "Expected Y ~82, got {}", avg_y);
        assert!((80..=100).contains(&avg_u), "Expected U ~90, got {}", avg_u);
        assert!(
            (230..=245).contains(&avg_v),
            "Expected V ~240, got {}",
            avg_v
        );
    }

    #[test]
    fn test_encode_synthetic_frames_to_mp4() -> Result<()> {
        let width = 128;
        let height = 128;
        let fps = 30.0;
        let sample_rate = 48_000;

        let mut encoder = Mp4Encoder::new_in_memory(width, height, fps, sample_rate)?;

        // Generate 10 synthetic solid-color frames cycling RGB colors
        for frame in 0..10 {
            let mut rgba = vec![0u8; (width * height * 4) as usize];
            let r = if frame % 3 == 0 { 255 } else { 0 };
            let g = if frame % 3 == 1 { 255 } else { 0 };
            let b = if frame % 3 == 2 { 255 } else { 0 };

            for pixel in rgba.chunks_exact_mut(4) {
                pixel[0] = r;
                pixel[1] = g;
                pixel[2] = b;
                pixel[3] = 255;
            }

            encoder.push_frame(&rgba)?;
        }

        let mp4_bytes = encoder.finish_to_buffer()?;

        assert!(!mp4_bytes.is_empty(), "MP4 buffer should not be empty");
        assert!(
            mp4_bytes.len() > 100,
            "MP4 file should have reasonable size, got {} bytes",
            mp4_bytes.len()
        );

        // Verify valid ISO MP4 header: bytes 4..8 should be b"ftyp"
        assert_eq!(
            &mp4_bytes[4..8],
            b"ftyp",
            "MP4 file should start with ftyp box"
        );

        // Verify readability by mp4::Mp4Reader
        let size = mp4_bytes.len() as u64;
        let cursor = Cursor::new(mp4_bytes);
        let reader = mp4::Mp4Reader::read_header(cursor, size)?;

        assert_eq!(reader.ftyp.major_brand, FourCC::from(*b"isom"));
        let tracks = reader.tracks();
        assert_eq!(tracks.len(), 1, "Expected exactly 1 video track");
        let video_track = tracks.values().next().unwrap();
        assert_eq!(video_track.track_type()?, TrackType::Video);
        assert_eq!(video_track.width(), width as u16);
        assert_eq!(video_track.height(), height as u16);

        Ok(())
    }

    #[test]
    fn test_encode_with_audio_track_to_file() -> Result<()> {
        let temp_dir = std::env::temp_dir();
        let out_file = temp_dir.join(format!("liosvideo_test_av_{}.mp4", std::process::id()));

        let width = 64;
        let height = 64;
        let fps = 30.0;
        let sample_rate = 48_000;

        let mut encoder = Mp4Encoder::new(
            &out_file,
            width,
            height,
            fps,
            sample_rate,
            10_000_000,
            192_000,
        )?;

        // Push 15 solid frames (~0.5s)
        let rgba = vec![120u8; (width * height * 4) as usize];
        for _ in 0..15 {
            encoder.push_frame(&rgba)?;
        }

        // Push 0.5s of stereo sine wave audio (48000 * 0.5 * 2 = 48000 samples)
        let num_samples = 48_000;
        let mut pcm = Vec::with_capacity(num_samples);
        for i in 0..(num_samples / 2) {
            let t = i as f32 / 48000.0;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
            pcm.push(sample); // Left
            pcm.push(sample); // Right
        }
        encoder.push_audio(&pcm)?;

        encoder.finish()?;

        // Verify output file on disk
        let metadata = std::fs::metadata(&out_file)?;
        assert!(
            metadata.len() > 500,
            "MP4 file size should be > 500 bytes, got {}",
            metadata.len()
        );

        let file = std::fs::File::open(&out_file)?;
        let size = file.metadata()?.len();
        let reader = mp4::Mp4Reader::read_header(file, size)?;

        assert_eq!(
            reader.tracks().len(),
            2,
            "Expected 2 tracks (video + audio)"
        );

        // Clean up temp file
        let _ = std::fs::remove_file(&out_file);

        Ok(())
    }

    #[test]
    fn never_repeats_a_previous_frame_when_the_bitrate_is_too_low() -> Result<()> {
        // Noise at a starved bitrate is what makes OpenH264 want to skip frames. A skipped frame
        // must not be filled by re-sending the previous P-frame's bytes: that duplicates its
        // frame_num and decoders show garbage ("reference picture missing").
        let (width, height) = (320u32, 240u32);
        let mut encoder = Mp4Encoder::with_output(
            Mp4Output::Cursor(Cursor::new(Vec::new())),
            width,
            height,
            30.0,
            48_000,
            100_000,
            192_000,
            VideoEncoderKind::Software,
        )?;
        let mut seed = 0x1234_5678u32;
        for _ in 0..30 {
            let mut rgba = vec![255u8; (width * height * 4) as usize];
            for px in rgba.chunks_exact_mut(4) {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                px[0] = seed as u8;
                px[1] = (seed >> 8) as u8;
                px[2] = (seed >> 16) as u8;
            }
            encoder.push_frame(&rgba)?;
        }
        let bytes = encoder.finish_to_buffer()?;
        let size = bytes.len() as u64;
        let mut reader = mp4::Mp4Reader::read_header(Cursor::new(bytes), size)?;
        let count = reader.sample_count(1)?;
        assert_eq!(count, 30, "one sample per frame");
        let mut previous: Option<Vec<u8>> = None;
        for i in 1..=count {
            let sample = reader.read_sample(1, i)?.expect("sample").bytes.to_vec();
            assert_ne!(previous.as_ref(), Some(&sample), "sample {i} repeats the previous frame's bytes");
            previous = Some(sample);
        }
        Ok(())
    }

    /// Encodes `frames` frames of one colour with `kind` and returns the MP4 bytes.
    fn encode_solid(kind: VideoEncoderKind, rgb: [u8; 3], frames: usize) -> Result<Vec<u8>> {
        let (width, height) = (320u32, 240u32);
        let mut encoder = Mp4Encoder::with_output(
            Mp4Output::Cursor(Cursor::new(Vec::new())),
            width,
            height,
            30.0,
            48_000,
            2_000_000,
            128_000,
            kind,
        )?;
        let mut rgba = vec![255u8; (width * height * 4) as usize];
        for px in rgba.chunks_exact_mut(4) {
            px[..3].copy_from_slice(&rgb);
        }
        for _ in 0..frames {
            encoder.push_frame(&rgba)?;
        }
        encoder.finish_to_buffer()
    }

    /// Decodes every sample with OpenH264 and returns the mean Y, U, V of the last frame.
    fn decode_last_frame(mp4: Vec<u8>) -> Result<(usize, [f64; 3], Vec<bool>)> {
        use openh264::formats::YUVSource;
        let size = mp4.len() as u64;
        let mut reader = mp4::Mp4Reader::read_header(Cursor::new(mp4), size)?;
        let track = reader.tracks().get(&1).expect("video track");
        let (sps, pps) = match &track.trak.mdia.minf.stbl.stsd.avc1 {
            Some(avc1) => (
                avc1.avcc.sequence_parameter_sets[0].bytes.clone(),
                avc1.avcc.picture_parameter_sets[0].bytes.clone(),
            ),
            None => panic!("no avc1 sample entry"),
        };
        let count = reader.sample_count(1)?;
        let mut decoder = openh264::decoder::Decoder::new()?;
        let mut annexb = Vec::new();
        for set in [&sps, &pps] {
            annexb.extend_from_slice(&[0, 0, 0, 1]);
            annexb.extend_from_slice(set);
        }
        decoder.decode(&annexb)?;
        let mut decoded = 0;
        let mut syncs = Vec::new();
        let mut mean = [0.0; 3];
        for i in 1..=count {
            let sample = reader.read_sample(1, i)?.expect("sample");
            syncs.push(sample.is_sync);
            let mut nal = Vec::new();
            let mut rest = &sample.bytes[..];
            while rest.len() >= 4 {
                let len = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
                nal.extend_from_slice(&[0, 0, 0, 1]);
                nal.extend_from_slice(&rest[4..4 + len]);
                rest = &rest[4 + len..];
            }
            if let Some(yuv) = decoder.decode(&nal)? {
                decoded += 1;
                let (w, h) = yuv.dimensions();
                let (sy, su, sv) = yuv.strides();
                let plane_mean = |p: &[u8], stride: usize, w: usize, h: usize| {
                    let mut sum = 0u64;
                    for row in 0..h {
                        sum += p[row * stride..row * stride + w].iter().map(|&v| v as u64).sum::<u64>();
                    }
                    sum as f64 / (w * h) as f64
                };
                mean = [
                    plane_mean(yuv.y(), sy, w, h),
                    plane_mean(yuv.u(), su, w / 2, h / 2),
                    plane_mean(yuv.v(), sv, w / 2, h / 2),
                ];
            }
        }
        Ok((decoded, mean, syncs))
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn videotoolbox_writes_a_decodable_bt709_stream_with_a_keyframe_every_two_seconds() -> Result<()> {
        let mp4 = encode_solid(VideoEncoderKind::Hardware, [200, 60, 30], 90)?;
        let report = crate::media::integrity::check(Cursor::new(&mp4), mp4.len() as u64, Some(90)).map_err(|e| anyhow!(e))?;
        assert_eq!(report.frames, 90);
        let (decoded, [y, u, v], syncs) = decode_last_frame(mp4)?;
        assert_eq!(decoded, 90, "every sample decodes");
        // BT.709 limited range for (200, 60, 30): Y 91, Cb 101, Cr 191 (BT.601 would be Y 101)
        assert!((y - 91.0).abs() < 3.0, "Y {y}");
        assert!((u - 101.0).abs() < 3.0, "Cb {u}");
        assert!((v - 191.0).abs() < 3.0, "Cr {v}");
        let keys: Vec<usize> = syncs.iter().enumerate().filter(|(_, s)| **s).map(|(i, _)| i).collect();
        assert_eq!(keys, vec![0, 60], "keyframes at 0 s and 2 s");
        Ok(())
    }

    #[test]
    fn openh264_still_writes_a_decodable_stream() -> Result<()> {
        let mp4 = encode_solid(VideoEncoderKind::Software, [200, 60, 30], 70)?;
        let (decoded, [y, ..], syncs) = decode_last_frame(mp4)?;
        assert_eq!(decoded, 70);
        assert!((y - 101.0).abs() < 3.0, "OpenH264 path keeps BT.601, Y {y}");
        assert!(syncs[0] && syncs[60]);
        Ok(())
    }

    #[test]
    fn parses_encoder_names() {
        assert_eq!(VideoEncoderKind::parse("auto").unwrap(), VideoEncoderKind::Auto);
        assert_eq!(VideoEncoderKind::parse("HW").unwrap(), VideoEncoderKind::Hardware);
        assert_eq!(VideoEncoderKind::parse("openh264").unwrap(), VideoEncoderKind::Software);
        assert!(VideoEncoderKind::parse("nvenc").is_err());
    }

    #[test]
    fn encoder_thread_writes_every_frame_and_the_audio() -> Result<()> {
        let out = std::env::temp_dir().join(format!("liosvideo_thread_{}.mp4", std::process::id()));
        let path = out.clone();
        let mut thread = EncoderThread::spawn(2, move || {
            Mp4Encoder::new_with_encoder(&path, 64, 64, 30.0, 48_000, 1_000_000, 128_000, VideoEncoderKind::Software)
        })?;
        assert_eq!(thread.encoder_name(), "OpenH264 (software)");
        for i in 0..20u8 {
            thread.push_frame(vec![i * 10; 64 * 64 * 4])?;
        }
        thread.finish_with_audio(vec![0.1; 48_000])?;
        let report = crate::media::integrity::check_file(&out, Some(20)).map_err(|e| anyhow!(e))?;
        assert_eq!(report.frames, 20);
        let file = std::fs::File::open(&out)?;
        let size = file.metadata()?.len();
        assert_eq!(mp4::Mp4Reader::read_header(file, size)?.tracks().len(), 2, "video + audio");
        let _ = std::fs::remove_file(&out);
        Ok(())
    }

    #[test]
    fn encoder_thread_reports_a_bad_frame() {
        let mut thread = EncoderThread::spawn(1, || Mp4Encoder::new_in_memory(64, 64, 30.0, 48_000)).unwrap();
        let mut result = Ok(());
        for _ in 0..4 {
            result = thread.push_frame(vec![0; 10]); // wrong size
            if result.is_err() {
                break;
            }
        }
        let err = result.err().or_else(|| thread.finish_with_audio(Vec::new()).err()).expect("an error");
        assert!(format!("{err:#}").contains("Invalid RGBA frame size"), "{err:#}");
    }
}
