use std::collections::HashMap;

use crate::media::loudness::{duck_gain_at, duck_plan, is_voice, should_duck, Duck};
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub use crate::runtime::{AudioClipInfo, AudioTrackInfo};

/// Default audio sample rate used for composition rendering (48kHz)
pub const DEFAULT_SAMPLE_RATE: u32 = 48_000;

/// Standalone audio decoder using Symphonia
pub struct AudioDecoder;

impl AudioDecoder {
    /// Decode an audio file from disk to interleaved stereo 32-bit float PCM at `target_rate`.
    pub fn decode_file(path: impl AsRef<Path>, target_rate: u32) -> Result<Vec<f32>> {
        let path = path.as_ref();
        let file = std::fs::File::open(path)
            .with_context(|| format!("Failed to open audio file: {}", path.display()))?;
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            hint.with_extension(ext);
        }
        Self::decode_media_source(Box::new(file), &hint, target_rate)
    }

    /// Decode audio from in-memory byte buffer to interleaved stereo 32-bit float PCM at `target_rate`.
    pub fn decode_bytes(
        bytes: Vec<u8>,
        hint_ext: Option<&str>,
        target_rate: u32,
    ) -> Result<Vec<f32>> {
        let mut hint = Hint::new();
        if let Some(ext) = hint_ext {
            hint.with_extension(ext);
        }
        let cursor = std::io::Cursor::new(bytes);
        let source = ReadOnlySource::new(cursor);
        Self::decode_media_source(Box::new(source), &hint, target_rate)
    }

    /// Decode audio from a boxed `MediaSource` to interleaved stereo 32-bit float PCM at `target_rate`.
    pub fn decode_media_source(
        source: Box<dyn MediaSource>,
        hint: &Hint,
        target_rate: u32,
    ) -> Result<Vec<f32>> {
        let mss = MediaSourceStream::new(source, Default::default());
        let format_opts = FormatOptions::default();
        let metadata_opts = MetadataOptions::default();

        let probed = symphonia::default::get_probe()
            .format(hint, mss, &format_opts, &metadata_opts)
            .context("Unsupported or invalid audio format")?;

        let mut format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| anyhow!("No supported audio track found in media source"))?;

        let track_id = track.id;
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .context("Failed to instantiate audio decoder")?;

        let mut sample_buf: Option<SampleBuffer<f32>> = None;
        let mut raw_samples = Vec::new();
        let mut source_rate = track.codec_params.sample_rate.unwrap_or(target_rate);
        let mut source_channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

        loop {
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(Error::ResetRequired) => {
                    decoder.reset();
                    continue;
                }
                Err(Error::IoError(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => {
                    break;
                }
                Err(Error::IoError(_)) => {
                    break;
                }
                Err(err) => {
                    return Err(anyhow!("Format read error: {err}"));
                }
            };

            if packet.track_id() != track_id {
                continue;
            }

            match decoder.decode(&packet) {
                Ok(decoded) => {
                    source_rate = decoded.spec().rate;
                    source_channels = decoded.spec().channels.count();

                    let capacity = decoded.capacity() as u64;
                    if sample_buf
                        .as_ref()
                        .map(|b| (b.capacity() as u64) < capacity)
                        .unwrap_or(true)
                    {
                        sample_buf = Some(SampleBuffer::<f32>::new(capacity, *decoded.spec()));
                    }

                    if let Some(buf) = sample_buf.as_mut() {
                        buf.copy_interleaved_ref(decoded);
                        raw_samples.extend_from_slice(buf.samples());
                    }
                }
                Err(Error::DecodeError(_)) => {
                    // skip corrupted packet
                    continue;
                }
                Err(Error::ResetRequired) => {
                    decoder.reset();
                }
                Err(err) => {
                    return Err(anyhow!("Audio decode error: {err}"));
                }
            }
        }

        if raw_samples.is_empty() {
            return Ok(Vec::new());
        }

        let stereo_samples = convert_to_stereo(&raw_samples, source_channels);
        let resampled = resample_linear_stereo(&stereo_samples, source_rate, target_rate);

        Ok(resampled)
    }
}

/// Convert planar or arbitrary channel layout interleaved float PCM to interleaved stereo `[L, R, L, R, ...]`.
pub fn convert_to_stereo(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels == 2 {
        return samples.to_vec();
    }
    if channels == 1 {
        let mut stereo = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            stereo.push(s);
            stereo.push(s);
        }
        return stereo;
    }
    if channels == 0 {
        return Vec::new();
    }

    // For multi-channel (> 2 channels), take the first two channels (Left, Right)
    let frames = samples.len() / channels;
    let mut stereo = Vec::with_capacity(frames * 2);
    for frame in 0..frames {
        stereo.push(samples[frame * channels]);
        stereo.push(samples[frame * channels + 1]);
    }
    stereo
}

/// Resample interleaved stereo PCM from `source_rate` to `target_rate` using linear interpolation.
pub fn resample_linear_stereo(
    stereo_samples: &[f32],
    source_rate: u32,
    target_rate: u32,
) -> Vec<f32> {
    if source_rate == target_rate || stereo_samples.is_empty() {
        return stereo_samples.to_vec();
    }

    let source_frames = stereo_samples.len() / 2;
    if source_frames == 0 {
        return Vec::new();
    }

    let ratio = source_rate as f64 / target_rate as f64;
    let target_frames =
        ((source_frames as f64) * (target_rate as f64) / (source_rate as f64)).round() as usize;
    let mut resampled = Vec::with_capacity(target_frames * 2);

    for i in 0..target_frames {
        let src_idx = (i as f64) * ratio;
        let idx0 = src_idx.floor() as usize;
        let idx1 = (idx0 + 1).min(source_frames.saturating_sub(1));
        let frac = (src_idx - idx0 as f64) as f32;

        let l0 = stereo_samples[idx0 * 2];
        let l1 = stereo_samples[idx1 * 2];
        let left = l0 + frac * (l1 - l0);

        let r0 = stereo_samples[idx0 * 2 + 1];
        let r1 = stereo_samples[idx1 * 2 + 1];
        let right = r0 + frac * (r1 - r0);

        resampled.push(left);
        resampled.push(right);
    }

    resampled
}

/// Mix a single decoded clip into the master stereo buffer.
///
/// Mirrors `apps/desktop/src/lib/export/audio_mixdown.ts`:
/// - `when = start_frame / fps`
/// - `offset = start_offset` seconds into the source
/// - optional `duration` (seconds) limits playback
/// - `volume` gain, no looping, no ducking
pub fn mix_clip_into(
    master: &mut [f32],
    clip_samples: &[f32],
    clip: &AudioClipInfo,
    fps: f64,
    sample_rate: u32,
) {
    mix_clip_with_gain(master, clip_samples, clip, fps, sample_rate, |_| 1.0);
}

/// `mix_clip_into` with an extra gain per master frame (used for ducking).
fn mix_clip_with_gain(
    master: &mut [f32],
    clip_samples: &[f32],
    clip: &AudioClipInfo,
    fps: f64,
    sample_rate: u32,
    gain: impl Fn(usize) -> f32,
) {
    if clip_samples.is_empty() || master.is_empty() {
        return;
    }

    let effective_fps = if fps > 0.0 { fps } else { 30.0 };
    let when = clip.start_frame as f64 / effective_fps;
    let offset = clip.start_offset.unwrap_or(0.0).max(0.0);
    let volume = clip.volume.unwrap_or(1.0).max(0.0) as f32;

    let start_master_sample = (when * sample_rate as f64).round() as usize * 2;
    let start_source_sample = (offset * sample_rate as f64).round() as usize * 2;

    if start_master_sample >= master.len() || start_source_sample >= clip_samples.len() {
        return;
    }

    let available_master = master.len() - start_master_sample;
    let available_source = clip_samples.len() - start_source_sample;

    let max_samples = match clip.duration {
        Some(duration) if duration > 0.0 => {
            ((duration * sample_rate as f64).round() as usize * 2).min(available_master)
        }
        _ => available_master,
    };

    let samples_to_mix = available_source.min(max_samples);

    // fades: linear from silence at the first frame / to silence at the last frame
    let frames = samples_to_mix / 2;
    let fade_frames = |seconds: Option<f64>| {
        seconds
            .filter(|s| *s > 0.0)
            .map(|s| (s * sample_rate as f64) as f32)
    };
    let fade_in = fade_frames(clip.fade_in);
    let fade_out = fade_frames(clip.fade_out);
    let envelope = |frame: usize| -> f32 {
        let mut g = 1.0f32;
        if let Some(n) = fade_in {
            g = g.min(frame as f32 / n);
        }
        if let Some(n) = fade_out {
            g = g.min(frames.saturating_sub(1 + frame) as f32 / n);
        }
        g
    };

    for i in 0..samples_to_mix {
        let at = start_master_sample + i;
        master[at] += clip_samples[start_source_sample + i] * volume * gain(at / 2) * envelope(i / 2);
    }
}

/// Mix all manifest audio clips into a master stereo buffer.
///
/// Music beds dip under voice-over when `duck` is set (see `media::loudness`).
/// The result is not clamped: run `loudness::master` on it, whose limiter keeps
/// every sample under the ceiling.
pub fn mix_audio_tracks(
    project_root: impl AsRef<Path>,
    tracks: &[AudioTrackInfo],
    total_seconds: f64,
    sample_rate: u32,
    fps: f64,
    duck: Option<Duck>,
) -> Result<Vec<f32>> {
    let project_root = project_root.as_ref();
    let total_frames = (total_seconds.max(0.0) * sample_rate as f64).ceil() as usize;
    let mut master = vec![0.0f32; total_frames * 2];
    let effective_fps = if fps > 0.0 { fps } else { 30.0 };

    let mut decoded: HashMap<String, Vec<f32>> = HashMap::new();
    let clips: Vec<&AudioClipInfo> = tracks
        .iter()
        .flat_map(|t| t.clips.iter())
        .filter(|c| !c.src.is_empty())
        .collect();

    for clip in &clips {
        if decoded.contains_key(&clip.src) {
            continue;
        }
        let path = if Path::new(&clip.src).is_absolute() {
            std::path::PathBuf::from(&clip.src)
        } else {
            project_root.join(&clip.src)
        };
        if !path.exists() {
            eprintln!("Warning: Audio file not found: {}", path.display());
            continue;
        }
        match AudioDecoder::decode_file(&path, sample_rate) {
            Ok(samples) => {
                decoded.insert(clip.src.clone(), samples);
            }
            Err(err) => {
                eprintln!(
                    "Warning: Failed to decode audio file {}: {err}",
                    path.display()
                );
            }
        }
    }

    // when each clip starts and how long it actually plays, in seconds
    let timing: Vec<Option<(f64, f64)>> = clips
        .iter()
        .map(|clip| {
            let samples = decoded.get(&clip.src)?;
            let start = clip.start_frame as f64 / effective_fps;
            let available = (samples.len() as f64 / 2.0 / sample_rate as f64
                - clip.start_offset.unwrap_or(0.0))
            .max(0.0);
            let played = clip
                .duration
                .filter(|d| *d > 0.0)
                .unwrap_or(available)
                .min(available)
                .min((total_seconds - start).max(0.0));
            Some((start, played))
        })
        .collect();
    let spans: Vec<(f64, f64)> = clips
        .iter()
        .zip(&timing)
        .filter_map(|(clip, t)| {
            let (start, played) = (*t)?;
            is_voice(&clip.src, clip.role.as_deref()).then_some((start, start + played))
        })
        .collect();
    let plan = duck_plan(&spans, duck);

    for (clip, t) in clips.iter().zip(&timing) {
        let (Some(samples), Some((_, played))) = (decoded.get(&clip.src), *t) else {
            continue;
        };
        if !plan.is_empty() && should_duck(&clip.src, clip.role.as_deref(), clip.ducking, played) {
            let rate = sample_rate as f64;
            mix_clip_with_gain(&mut master, samples, clip, fps, sample_rate, |frame| {
                duck_gain_at(&plan, frame as f64 / rate) as f32
            });
        } else {
            mix_clip_into(&mut master, samples, clip, fps, sample_rate);
        }
    }

    Ok(master)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(
        src: &str,
        start_frame: usize,
        start_offset: Option<f64>,
        duration: Option<f64>,
        volume: Option<f64>,
    ) -> AudioClipInfo {
        AudioClipInfo {
            src: src.to_string(),
            start_frame,
            end_frame: 0,
            duration,
            start_offset,
            volume,
            ducking: None,
            role: None,
            fade_in: None,
            fade_out: None,
        }
    }

    fn track(clips: Vec<AudioClipInfo>) -> AudioTrackInfo {
        AudioTrackInfo {
            id: "t".to_string(),
            name: None,
            clips,
        }
    }

    fn create_test_wav(sample_rate: u32, channels: u16, pcm_samples: &[i16]) -> Vec<u8> {
        let mut bytes = Vec::new();
        let num_channels = channels;
        let bits_per_sample = 16u16;
        let byte_rate = sample_rate * (num_channels as u32) * (bits_per_sample as u32) / 8;
        let block_align = num_channels * bits_per_sample / 8;
        let data_len = (pcm_samples.len() * 2) as u32;
        let riff_chunk_size = 36 + data_len;

        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&riff_chunk_size.to_le_bytes());
        bytes.extend_from_slice(b"WAVE");

        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&num_channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits_per_sample.to_le_bytes());

        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for &sample in pcm_samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        bytes
    }

    #[test]
    fn test_convert_to_stereo() {
        let mono = vec![0.1, 0.2, 0.3];
        let stereo = convert_to_stereo(&mono, 1);
        assert_eq!(stereo, vec![0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);

        let existing_stereo = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(convert_to_stereo(&existing_stereo, 2), existing_stereo);

        let quad = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        assert_eq!(convert_to_stereo(&quad, 4), vec![1.0, 2.0, 5.0, 6.0]);
    }

    #[test]
    fn test_resample_linear_stereo() {
        let src = vec![0.0, 0.0, 1.0, 1.0];
        let resampled = resample_linear_stereo(&src, 1000, 2000);
        assert_eq!(resampled.len(), 8);
        assert_eq!(resampled[0], 0.0);
        assert!((resampled[2] - 0.5).abs() < 1e-4);
    }

    #[test]
    fn fades_a_clip_in_and_out() {
        let sample_rate = 1000;
        let samples = vec![1.0f32; 20]; // 10 stereo frames
        let mut clip = clip("sfx.wav", 0, None, None, None);
        clip.fade_in = Some(0.004); // 4 frames
        clip.fade_out = Some(0.004);
        let mut master = vec![0.0f32; 20];

        mix_clip_into(&mut master, &samples, &clip, 1000.0, sample_rate);

        let frame = |i: usize| master[i * 2];
        assert_eq!(frame(0), 0.0);
        assert!((frame(2) - 0.5).abs() < 1e-6);
        assert!((frame(5) - 1.0).abs() < 1e-6);
        assert!((frame(7) - 0.5).abs() < 1e-6);
        assert_eq!(frame(9), 0.0);
        assert_eq!(master[3], master[2], "both channels get the same gain");
    }

    #[test]
    fn mixes_clip_with_offset_duration_and_volume() {
        let sample_rate = 1000;
        let samples = vec![1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]; // 4 stereo frames
        let clip = clip("a.mp3", 1, Some(0.001), Some(0.002), Some(0.5)); // starts frame 1, skip 1 frame, 2 frames at 0.5
        let mut master = vec![0.0f32; 10];

        mix_clip_into(&mut master, &samples, &clip, 1000.0, sample_rate);

        assert_eq!(master[0], 0.0);
        assert_eq!(master[1], 0.0);
        assert!((master[2] - 0.5).abs() < 1e-6);
        assert!((master[3] - 0.5).abs() < 1e-6);
        assert!((master[4] - 0.5).abs() < 1e-6);
        assert!((master[5] - 0.5).abs() < 1e-6);
        assert_eq!(master[6], 0.0);
    }

    #[test]
    fn clips_do_not_loop() {
        let samples = vec![0.4, 0.4]; // 1 stereo frame
        let clip = clip("a.mp3", 0, None, None, None);
        let mut master = vec![0.0f32; 6];

        mix_clip_into(&mut master, &samples, &clip, 30.0, 1000);

        assert!((master[0] - 0.4).abs() < 1e-6);
        assert_eq!(master[2], 0.0);
        assert_eq!(master[4], 0.0);
    }

    #[test]
    fn clamps_mixed_output() {
        let mut master = vec![0.8f32; 2];
        let samples = vec![0.8f32; 2];
        let clip = clip("a.mp3", 0, None, None, None);
        mix_clip_into(&mut master, &samples, &clip, 30.0, 1000);
        for sample in &mut master {
            *sample = sample.clamp(-1.0, 1.0);
        }
        assert_eq!(master[0], 1.0);
    }

    #[test]
    fn test_audio_decoder_wav() {
        let num_samples = 4410;
        let mut pcm = Vec::with_capacity(num_samples);
        for i in 0..num_samples {
            let val = ((i % 100) as i16 - 50) * 300;
            pcm.push(val);
        }

        let wav_bytes = create_test_wav(44100, 1, &pcm);
        let decoded =
            AudioDecoder::decode_bytes(wav_bytes, Some("wav"), 48000).expect("WAV decode failed");

        assert_eq!(decoded.len(), 9600);
        let max_val = decoded.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
        assert!(max_val > 0.1 && max_val <= 1.0);
    }

    #[test]
    fn test_mix_audio_tracks_with_file() {
        let temp_dir =
            std::env::temp_dir().join(format!("liosvideo_audio_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let wav_path = temp_dir.join("test.wav");

        let pcm = vec![10000i16, 10000i16, 20000i16, 20000i16];
        let wav_bytes = create_test_wav(48000, 2, &pcm);
        std::fs::write(&wav_path, wav_bytes).unwrap();

        let tracks = vec![track(vec![clip("test.wav", 0, None, None, Some(1.0))])];
        let mixed = mix_audio_tracks(&temp_dir, &tracks, 0.001, 48000, 30.0, None)
            .expect("mix_audio_tracks failed");

        assert!(!mixed.is_empty());
        assert!(mixed[0] > 0.0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn ducks_a_music_bed_under_voice_over() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets/audio/music")).unwrap();
        std::fs::create_dir_all(dir.path().join("assets/audio/vo")).unwrap();
        let bed = vec![16384i16; 48000 * 2 * 12]; // 12 s at 0.5
        std::fs::write(
            dir.path().join("assets/audio/music/bed.wav"),
            create_test_wav(48000, 2, &bed),
        )
        .unwrap();
        let line = vec![8192i16; 48000 * 2]; // 1 s at 0.25
        std::fs::write(
            dir.path().join("assets/audio/vo/a.wav"),
            create_test_wav(48000, 2, &line),
        )
        .unwrap();

        let tracks = vec![
            track(vec![clip(
                "assets/audio/music/bed.wav",
                0,
                None,
                None,
                None,
            )]),
            track(vec![clip("assets/audio/vo/a.wav", 60, None, None, None)]), // 2 s
        ];
        let duck = crate::media::loudness::MixSettings::default().duck;
        let mixed = mix_audio_tracks(dir.path(), &tracks, 10.0, 48000, 30.0, duck).unwrap();
        let at = |t: f64| mixed[(t * 48000.0) as usize * 2];
        let low = 0.5 * 10f32.powf(-12.0 / 20.0);
        assert!((at(1.0) - 0.5).abs() < 1e-3, "{}", at(1.0));
        assert!((at(2.5) - (low + 0.25)).abs() < 1e-3, "{}", at(2.5));
        assert!((at(4.0) - 0.5).abs() < 1e-3, "{}", at(4.0));

        let flat = mix_audio_tracks(dir.path(), &tracks, 10.0, 48000, 30.0, None).unwrap();
        assert!((flat[(2.5 * 48000.0) as usize * 2] - 0.75).abs() < 1e-3);
    }
}
