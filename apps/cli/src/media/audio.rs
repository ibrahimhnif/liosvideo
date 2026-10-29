use std::path::Path;
use anyhow::{anyhow, Context, Result};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub use crate::runtime::AudioTrackInfo;

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
    pub fn decode_bytes(bytes: Vec<u8>, hint_ext: Option<&str>, target_rate: u32) -> Result<Vec<f32>> {
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
                    if sample_buf.as_ref().map(|b| (b.capacity() as u64) < capacity).unwrap_or(true) {
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
    let target_frames = ((source_frames as f64) * (target_rate as f64) / (source_rate as f64)).round() as usize;
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

/// Software PCM mixer that mixes decoded track samples into a master stereo buffer.
///
/// Handles track volume attenuation, start time offset (in seconds or frame/fps),
/// duration clipping, and looping. Final mixed samples are clamped to `[-1.0, 1.0]`.
pub fn mix_pcm_tracks(
    tracks: &[(&[f32], &AudioTrackInfo)],
    total_seconds: f64,
    sample_rate: u32,
    fps: f64,
) -> Vec<f32> {
    let total_frames = (total_seconds.max(0.0) * sample_rate as f64).ceil() as usize;
    let total_samples = total_frames * 2;
    let mut master_buffer = vec![0.0f32; total_samples];

    if total_samples == 0 {
        return master_buffer;
    }

    let effective_fps = if fps > 0.0 { fps } else { 30.0 };

    for (track_samples, track) in tracks {
        if track_samples.is_empty() {
            continue;
        }

        let start_sec = track.start_at.unwrap_or_else(|| {
            track.start_frame.map(|f| f as f64 / effective_fps).unwrap_or(0.0)
        });

        let volume = track.volume.unwrap_or(1.0).max(0.0) as f32;
        let is_loop = track.loop_track.unwrap_or(false);

        let (start_master_idx, skip_track_samples) = if start_sec >= 0.0 {
            (((start_sec * sample_rate as f64).round() as usize * 2), 0)
        } else {
            (0, ((-start_sec * sample_rate as f64).round() as usize * 2))
        };

        if start_master_idx >= master_buffer.len() {
            continue;
        }

        let available_master_samples = master_buffer.len() - start_master_idx;
        let max_allowed_samples = match track.duration {
            Some(dur) => ((dur.max(0.0) * sample_rate as f64).round() as usize * 2).min(available_master_samples),
            None => available_master_samples,
        };

        if is_loop {
            for i in 0..max_allowed_samples {
                let track_idx = (skip_track_samples + i) % track_samples.len();
                master_buffer[start_master_idx + i] += track_samples[track_idx] * volume;
            }
        } else if skip_track_samples < track_samples.len() {
            let remaining_track_samples = track_samples.len() - skip_track_samples;
            let samples_to_mix = remaining_track_samples.min(max_allowed_samples);
            for i in 0..samples_to_mix {
                master_buffer[start_master_idx + i] += track_samples[skip_track_samples + i] * volume;
            }
        }
    }

    // Clamp mixed samples to [-1.0, 1.0] to prevent clipping
    for s in master_buffer.iter_mut() {
        *s = s.clamp(-1.0, 1.0);
    }

    master_buffer
}

/// Mix audio tracks for a composition.
///
/// - Resolves `src` relative to `project_root`
/// - Decodes audio files using Symphonia to stereo PCM at `sample_rate`
/// - Mixes all tracks into a master buffer of length `(total_seconds * sample_rate).ceil() * 2`
/// - Handles `start_at`, `start_frame`, `volume`, `duration`, and `loop_track`
/// - Clamps final samples to `[-1.0, 1.0]`
pub fn mix_audio_tracks(
    project_root: impl AsRef<Path>,
    tracks: &[AudioTrackInfo],
    total_seconds: f64,
    sample_rate: u32,
) -> Result<Vec<f32>> {
    mix_audio_tracks_with_fps(project_root, tracks, total_seconds, sample_rate, 30.0)
}

/// Mix audio tracks for a composition with explicit framerate for frame-based offsets.
pub fn mix_audio_tracks_with_fps(
    project_root: impl AsRef<Path>,
    tracks: &[AudioTrackInfo],
    total_seconds: f64,
    sample_rate: u32,
    fps: f64,
) -> Result<Vec<f32>> {
    let project_root = project_root.as_ref();
    let mut decoded_tracks: Vec<(Vec<f32>, &AudioTrackInfo)> = Vec::new();

    for track in tracks {
        let src = match &track.src {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };

        let track_path = if Path::new(src).is_absolute() {
            Path::new(src).to_path_buf()
        } else {
            project_root.join(src)
        };

        if !track_path.exists() {
            eprintln!("Warning: Audio file not found: {}", track_path.display());
            continue;
        }

        match AudioDecoder::decode_file(&track_path, sample_rate) {
            Ok(samples) => {
                decoded_tracks.push((samples, track));
            }
            Err(err) => {
                eprintln!(
                    "Warning: Failed to decode audio file {}: {err}",
                    track_path.display()
                );
            }
        }
    }

    let track_refs: Vec<(&[f32], &AudioTrackInfo)> = decoded_tracks
        .iter()
        .map(|(samples, track)| (samples.as_slice(), *track))
        .collect();

    Ok(mix_pcm_tracks(&track_refs, total_seconds, sample_rate, fps))
}

/// Convenience standalone function when track paths are already resolved or relative to current dir.
pub fn mix_audio_tracks_standalone(
    tracks: &[AudioTrackInfo],
    total_seconds: f64,
    sample_rate: u32,
) -> Result<Vec<f32>> {
    mix_audio_tracks("", tracks, total_seconds, sample_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

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

        // fmt subchunk
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes()); // subchunk1 size (16 for PCM)
        bytes.extend_from_slice(&1u16.to_le_bytes());  // Audio format 1 = PCM
        bytes.extend_from_slice(&num_channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits_per_sample.to_le_bytes());

        // data subchunk
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for &sample in pcm_samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        bytes
    }

    #[test]
    fn test_convert_to_stereo() {
        // Mono to stereo duplication
        let mono = vec![0.1, 0.2, 0.3];
        let stereo = convert_to_stereo(&mono, 1);
        assert_eq!(stereo, vec![0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);

        // Stereo identity
        let existing_stereo = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(convert_to_stereo(&existing_stereo, 2), existing_stereo);

        // Multi-channel downmix takes first two channels
        let quad = vec![
            1.0, 2.0, 3.0, 4.0, // frame 0
            5.0, 6.0, 7.0, 8.0, // frame 1
        ];
        let stereo_quad = convert_to_stereo(&quad, 4);
        assert_eq!(stereo_quad, vec![1.0, 2.0, 5.0, 6.0]);
    }

    #[test]
    fn test_resample_linear_stereo() {
        // Simple 2-frame stereo at 1000 Hz resampled to 2000 Hz (2x upsampling)
        let src = vec![0.0, 0.0, 1.0, 1.0];
        let resampled = resample_linear_stereo(&src, 1000, 2000);
        assert_eq!(resampled.len(), 8); // 4 stereo frames = 8 samples

        // Frame 0 should be 0.0
        assert_eq!(resampled[0], 0.0);
        assert_eq!(resampled[1], 0.0);
        // Frame 1 is halfway between 0.0 and 1.0 -> ~0.5
        assert!((resampled[2] - 0.5).abs() < 1e-4);
        assert!((resampled[3] - 0.5).abs() < 1e-4);
    }

    #[test]
    fn test_mix_pcm_tracks_volume_and_offset() {
        let sample_rate = 1000;
        let track1_samples = [0.5, 0.5, 0.5, 0.5]; // 2 stereo frames

        let track1_info = AudioTrackInfo {
            id: "track-1".into(),
            src: None,
            start_at: Some(0.001), // Starts at frame 1 (offset 1 frame = 2 samples)
            start_frame: None,
            duration: None,
            volume: Some(0.5), // 0.5 * 0.5 = 0.25
            loop_track: Some(false),
        };

        let tracks = [(&track1_samples[..], &track1_info)];
        let mixed = mix_pcm_tracks(&tracks, 0.005, sample_rate, 30.0);

        // Total 5 frames = 10 samples
        assert_eq!(mixed.len(), 10);
        // Frame 0 (samples 0, 1) should be 0.0
        assert_eq!(mixed[0], 0.0);
        assert_eq!(mixed[1], 0.0);
        // Frame 1 (samples 2, 3) should be attenuated to 0.25
        assert!((mixed[2] - 0.25).abs() < 1e-5);
        assert!((mixed[3] - 0.25).abs() < 1e-5);
        // Frame 2 (samples 4, 5) should be attenuated to 0.25
        assert!((mixed[4] - 0.25).abs() < 1e-5);
        assert!((mixed[5] - 0.25).abs() < 1e-5);
        // Frame 3 (samples 6, 7) should be 0.0
        assert_eq!(mixed[6], 0.0);
        assert_eq!(mixed[7], 0.0);
    }

    #[test]
    fn test_mix_pcm_tracks_duration_clipping_and_looping() {
        let sample_rate = 1000;
        let short_clip = [0.4, 0.4]; // 1 stereo frame

        // Looping track: repeats for the entire composition duration (3 frames)
        let loop_info = AudioTrackInfo {
            id: "loop-track".into(),
            src: None,
            start_at: Some(0.0),
            start_frame: None,
            duration: None,
            volume: Some(1.0),
            loop_track: Some(true),
        };

        let tracks = [(&short_clip[..], &loop_info)];
        let mixed = mix_pcm_tracks(&tracks, 0.003, sample_rate, 30.0);
        assert_eq!(mixed.len(), 6);
        for &s in &mixed {
            assert!((s - 0.4).abs() < 1e-5);
        }

        // Duration clipping: 1s duration cap on a looping track in 5s composition
        let clipped_info = AudioTrackInfo {
            id: "clipped".into(),
            src: None,
            start_at: Some(0.0),
            start_frame: None,
            duration: Some(0.002), // clip at 2 frames (4 samples)
            volume: Some(1.0),
            loop_track: Some(true),
        };

        let tracks2 = [(&short_clip[..], &clipped_info)];
        let mixed2 = mix_pcm_tracks(&tracks2, 0.004, sample_rate, 30.0);
        assert_eq!(mixed2.len(), 8);
        assert!((mixed2[0] - 0.4).abs() < 1e-5);
        assert!((mixed2[1] - 0.4).abs() < 1e-5);
        assert!((mixed2[2] - 0.4).abs() < 1e-5);
        assert!((mixed2[3] - 0.4).abs() < 1e-5);
        // Frames 2 and 3 should be 0.0 due to duration clipping
        assert_eq!(mixed2[4], 0.0);
        assert_eq!(mixed2[5], 0.0);
        assert_eq!(mixed2[6], 0.0);
        assert_eq!(mixed2[7], 0.0);
    }

    #[test]
    fn test_mix_pcm_tracks_clamping() {
        let sample_rate = 1000;
        let loud_track1 = [0.8, 0.8];
        let loud_track2 = [0.8, 0.8];

        let track1 = AudioTrackInfo {
            id: "t1".into(),
            src: None,
            start_at: Some(0.0),
            start_frame: None,
            duration: None,
            volume: Some(1.0),
            loop_track: None,
        };
        let track2 = AudioTrackInfo {
            id: "t2".into(),
            src: None,
            start_at: Some(0.0),
            start_frame: None,
            duration: None,
            volume: Some(1.0),
            loop_track: None,
        };

        let tracks = [
            (&loud_track1[..], &track1),
            (&loud_track2[..], &track2),
        ];

        // 0.8 + 0.8 = 1.6 -> clamped to 1.0
        let mixed = mix_pcm_tracks(&tracks, 0.001, sample_rate, 30.0);
        assert_eq!(mixed.len(), 2);
        assert_eq!(mixed[0], 1.0);
        assert_eq!(mixed[1], 1.0);
    }

    #[test]
    fn test_audio_decoder_wav() {
        // Create a 16-bit PCM mono 44.1kHz audio buffer
        let num_samples = 4410; // 0.1 seconds of audio
        let mut pcm = Vec::with_capacity(num_samples);
        for i in 0..num_samples {
            // Generate a simple triangle wave
            let val = ((i % 100) as i16 - 50) * 300;
            pcm.push(val);
        }

        let wav_bytes = create_test_wav(44100, 1, &pcm);
        let decoded = AudioDecoder::decode_bytes(wav_bytes, Some("wav"), 48000)
            .expect("WAV decode failed");

        // Should be resampled to 48000 Hz stereo
        // 0.1s at 48000 Hz = 4800 frames * 2 channels = 9600 samples
        assert_eq!(decoded.len(), 9600);

        // Verify samples are non-zero and within [-1.0, 1.0]
        let max_val = decoded.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
        assert!(max_val > 0.1 && max_val <= 1.0);
    }

    #[test]
    fn test_mix_audio_tracks_with_file() {
        let temp_dir = std::env::temp_dir().join(format!("liosvideo_audio_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let wav_path = temp_dir.join("test.wav");

        let pcm = vec![10000i16, 10000i16, 20000i16, 20000i16]; // 2 stereo frames at 48kHz
        let wav_bytes = create_test_wav(48000, 2, &pcm);
        std::fs::write(&wav_path, wav_bytes).unwrap();

        let track_info = AudioTrackInfo {
            id: "test-track".into(),
            src: Some("test.wav".into()),
            start_at: Some(0.0),
            start_frame: None,
            duration: None,
            volume: Some(1.0),
            loop_track: Some(false),
        };

        let mixed = mix_audio_tracks(&temp_dir, &[track_info], 0.001, 48000)
            .expect("mix_audio_tracks failed");

        assert!(!mixed.is_empty());
        assert!(mixed[0] > 0.0);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
