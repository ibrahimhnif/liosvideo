//! Post-render integrity check for the H.264 MP4s the encoder writes.
//!
//! Re-reads the file and walks every video sample's slice headers. A frame whose `frame_num`
//! repeats or skips the previous reference frame's breaks decoding: players report "reference
//! picture missing" and paste blocks from other frames (the "blue blur" glitch of v0.1.7). The
//! render fails loudly instead of leaving a file that looks fine until it is posted.

use std::io::{Read, Seek};
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub struct IntegrityReport {
    pub frames: u32,
    pub keyframes: u32,
}

/// Checks an MP4 file on disk; `expected_frames` also verifies nothing was dropped.
pub fn check_file(path: &Path, expected_frames: Option<u32>) -> Result<IntegrityReport, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("couldn't open {}: {e}", path.display()))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    check(std::io::BufReader::new(file), size, expected_frames)
}

pub fn check<R: Read + Seek>(reader: R, size: u64, expected_frames: Option<u32>) -> Result<IntegrityReport, String> {
    let mut mp4 = mp4::Mp4Reader::read_header(reader, size).map_err(|e| format!("not a readable MP4: {e}"))?;
    let (track_id, max_frame_num, length_size) = {
        let track = mp4
            .tracks()
            .values()
            .find(|t| t.track_type().ok() == Some(mp4::TrackType::Video))
            .ok_or("the MP4 has no video track")?;
        let sps = track.sequence_parameter_set().map_err(|e| format!("no H.264 SPS: {e}"))?;
        let log2 = log2_max_frame_num(sps)?;
        let length_size = track
            .trak
            .mdia
            .minf
            .stbl
            .stsd
            .avc1
            .as_ref()
            .map(|a| (a.avcc.length_size_minus_one & 0x3) as usize + 1)
            .unwrap_or(4);
        (track.track_id(), 1u32 << log2, length_size)
    };

    let count = mp4.sample_count(track_id).map_err(|e| e.to_string())?;
    if let Some(expected) = expected_frames {
        if count != expected {
            return Err(format!("rendered {expected} frames but the file has {count}"));
        }
    }

    let mut keyframes = 0;
    let mut prev_ref: Option<u32> = None;
    for index in 0..count {
        let sample = mp4
            .read_sample(track_id, index + 1)
            .map_err(|e| format!("frame {index}: unreadable sample: {e}"))?
            .ok_or_else(|| format!("frame {index}: sample is missing"))?;
        let slice = first_slice(&sample.bytes, length_size)
            .map_err(|e| format!("frame {index}: {e}"))?
            .ok_or_else(|| format!("frame {index}: no picture data"))?;
        let frame_num = slice_frame_num(&slice.rbsp, max_frame_num).map_err(|e| format!("frame {index}: {e}"))?;
        if slice.idr {
            keyframes += 1;
            if frame_num != 0 {
                return Err(format!("frame {index}: keyframe has frame_num {frame_num}, expected 0"));
            }
        } else {
            let Some(prev) = prev_ref else {
                return Err(format!("frame {index}: the stream does not start with a keyframe"));
            };
            let expected = (prev + 1) % max_frame_num;
            if frame_num != expected {
                let what = if frame_num == prev {
                    "repeats the previous reference frame (a frame was duplicated)".to_string()
                } else {
                    format!("skips from {prev} (a frame was dropped)")
                };
                return Err(format!(
                    "frame {index}: frame_num {frame_num} {what}; players will show corrupted frames"
                ));
            }
        }
        if slice.reference {
            prev_ref = Some(frame_num);
        }
    }
    Ok(IntegrityReport { frames: count, keyframes })
}

struct Slice {
    idr: bool,
    reference: bool,
    /// Slice RBSP after the NAL header byte, emulation-prevention bytes removed.
    rbsp: Vec<u8>,
}

/// First coded slice (NAL type 1 or 5) of a length-prefixed sample.
fn first_slice(sample: &[u8], length_size: usize) -> Result<Option<Slice>, String> {
    let mut pos = 0;
    while pos + length_size <= sample.len() {
        let len = sample[pos..pos + length_size].iter().fold(0usize, |acc, b| (acc << 8) | *b as usize);
        pos += length_size;
        let end = pos.checked_add(len).filter(|&e| e <= sample.len()).ok_or("truncated NAL unit")?;
        let nal = &sample[pos..end];
        pos = end;
        let Some(&header) = nal.first() else { continue };
        let kind = header & 0x1f;
        if kind == 1 || kind == 5 {
            return Ok(Some(Slice { idr: kind == 5, reference: header & 0x60 != 0, rbsp: unescape(&nal[1..]) }));
        }
    }
    Ok(None)
}

fn unescape(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut zeros = 0;
    for &byte in data {
        if zeros >= 2 && byte == 3 {
            zeros = 0;
            continue;
        }
        zeros = if byte == 0 { zeros + 1 } else { 0 };
        out.push(byte);
    }
    out
}

struct Bits<'a> {
    data: &'a [u8],
    pos: usize,
}

impl Bits<'_> {
    fn bit(&mut self) -> Result<u32, String> {
        let byte = *self.data.get(self.pos / 8).ok_or("header ends early")?;
        let bit = (byte >> (7 - self.pos % 8)) & 1;
        self.pos += 1;
        Ok(bit as u32)
    }

    fn bits(&mut self, n: u32) -> Result<u32, String> {
        (0..n).try_fold(0, |acc, _| Ok((acc << 1) | self.bit()?))
    }

    fn ue(&mut self) -> Result<u32, String> {
        let mut zeros = 0;
        while self.bit()? == 0 {
            zeros += 1;
            if zeros > 31 {
                return Err("invalid exp-Golomb code".into());
            }
        }
        Ok((1u32 << zeros) - 1 + self.bits(zeros)?)
    }

    fn se(&mut self) -> Result<i32, String> {
        let k = self.ue()? as i64;
        Ok(if k % 2 == 1 { ((k + 1) / 2) as i32 } else { -(k / 2) as i32 })
    }
}

/// `log2_max_frame_num` from an SPS NAL (header byte included).
fn log2_max_frame_num(sps: &[u8]) -> Result<u32, String> {
    let rbsp = unescape(sps.get(1..).ok_or("empty SPS")?);
    let mut b = Bits { data: &rbsp, pos: 0 };
    let profile = b.bits(8)?;
    b.bits(16)?; // constraint flags + level
    b.ue()?; // seq_parameter_set_id
    if [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].contains(&profile) {
        let chroma = b.ue()?;
        if chroma == 3 {
            b.bit()?; // separate_colour_plane_flag
        }
        b.ue()?; // bit_depth_luma_minus8
        b.ue()?; // bit_depth_chroma_minus8
        b.bit()?; // qpprime_y_zero_transform_bypass_flag
        if b.bit()? == 1 {
            for i in 0..if chroma == 3 { 12 } else { 8 } {
                if b.bit()? == 1 {
                    let size = if i < 6 { 16 } else { 64 };
                    let (mut last, mut next) = (8i32, 8i32);
                    for _ in 0..size {
                        if next != 0 {
                            next = (last + b.se()? + 256) % 256;
                        }
                        if next != 0 {
                            last = next;
                        }
                    }
                }
            }
        }
    }
    Ok(b.ue()? + 4)
}

fn slice_frame_num(rbsp: &[u8], max_frame_num: u32) -> Result<u32, String> {
    let mut b = Bits { data: rbsp, pos: 0 };
    b.ue()?; // first_mb_in_slice
    b.ue()?; // slice_type
    b.ue()?; // pic_parameter_set_id
    b.bits(max_frame_num.trailing_zeros())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::encoder::Mp4Encoder;
    use mp4::{AvcConfig, MediaConfig, Mp4Config, Mp4Sample, TrackConfig, TrackType};
    use std::io::Cursor;

    const W: u32 = 128;
    const H: u32 = 128;

    /// 70 noisy frames: IDR at 0 and 60 (2 s at 30 fps), P-frames in between.
    fn encoded() -> Vec<u8> {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("clip.mp4");
        // a bitrate sane for the frame size, as a real render would use
        let mut encoder = Mp4Encoder::new(&out, W, H, 30.0, 48_000, 400_000, 128_000).unwrap();
        let mut seed = 7u32;
        for i in 0..70 {
            let mut rgba = vec![255u8; (W * H * 4) as usize];
            for px in rgba.chunks_exact_mut(4) {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                px[0] = seed as u8;
                px[1] = (seed >> 8) as u8;
            }
            encoder.push_frame(&rgba).unwrap_or_else(|e| panic!("push frame {i}: {e}"));
        }
        encoder.finish().unwrap();
        std::fs::read(&out).unwrap()
    }

    /// Rewrites the video track's samples (as returned by `edit`) into a new MP4.
    fn rewrite(mp4_bytes: &[u8], edit: impl FnOnce(&mut Vec<Mp4Sample>)) -> Vec<u8> {
        let size = mp4_bytes.len() as u64;
        let mut reader = mp4::Mp4Reader::read_header(Cursor::new(mp4_bytes.to_vec()), size).unwrap();
        let track = reader.tracks().get(&1).unwrap();
        let sps = track.sequence_parameter_set().unwrap().to_vec();
        let pps = track.picture_parameter_set().unwrap().to_vec();
        let timescale = track.timescale();
        let count = reader.sample_count(1).unwrap();
        let mut samples: Vec<Mp4Sample> = (1..=count).map(|i| reader.read_sample(1, i).unwrap().unwrap()).collect();
        edit(&mut samples);
        let config = Mp4Config {
            major_brand: "isom".parse().unwrap(),
            minor_version: 512,
            compatible_brands: vec!["isom".parse().unwrap(), "avc1".parse().unwrap()],
            timescale,
        };
        let mut writer = mp4::Mp4Writer::write_start(Cursor::new(Vec::new()), &config).unwrap();
        writer
            .add_track(&TrackConfig {
                track_type: TrackType::Video,
                timescale,
                language: "und".into(),
                media_conf: MediaConfig::AvcConfig(AvcConfig {
                    width: W as u16,
                    height: H as u16,
                    seq_param_set: sps,
                    pic_param_set: pps,
                }),
            })
            .unwrap();
        let duration = samples[0].duration;
        for (i, mut sample) in samples.into_iter().enumerate() {
            sample.start_time = i as u64 * duration as u64;
            writer.write_sample(1, &sample).unwrap();
        }
        writer.write_end().unwrap();
        writer.into_writer().into_inner()
    }

    trait CloneMeta {
        fn clone_meta(&self) -> Mp4Sample;
    }
    impl CloneMeta for Mp4Sample {
        fn clone_meta(&self) -> Mp4Sample {
            Mp4Sample {
                start_time: self.start_time,
                duration: self.duration,
                rendering_offset: self.rendering_offset,
                is_sync: self.is_sync,
                bytes: self.bytes.clone(),
            }
        }
    }

    fn run(bytes: &[u8], expected: Option<u32>) -> Result<IntegrityReport, String> {
        check(Cursor::new(bytes.to_vec()), bytes.len() as u64, expected)
    }

    #[test]
    fn accepts_a_clean_render() {
        let report = run(&encoded(), Some(70)).unwrap();
        assert_eq!(report.frames, 70);
        // IDR at 0 and every 2 s; OpenH264 adds more on scene changes
        assert!(report.keyframes >= 2, "{report:?}");
    }

    #[test]
    fn rejects_a_repeated_p_frame() {
        // the v0.1.7 bug: a skipped frame filled with the previous P-frame's bytes
        let broken = rewrite(&encoded(), |s| {
            s[5] = Mp4Sample { bytes: s[4].bytes.clone(), ..s[5].clone_meta() };
        });
        let err = run(&broken, None).unwrap_err();
        assert!(err.contains("frame 5"), "{err}");
        assert!(err.contains("frame_num"), "{err}");
    }

    #[test]
    fn rejects_a_dropped_reference_frame() {
        let broken = rewrite(&encoded(), |s| {
            s.remove(10);
        });
        let err = run(&broken, None).unwrap_err();
        assert!(err.contains("frame 10"), "{err}");
    }

    #[test]
    fn rejects_a_frame_count_that_does_not_match_the_render() {
        let err = run(&encoded(), Some(71)).unwrap_err();
        assert!(err.contains("70") && err.contains("71"), "{err}");
    }

    #[test]
    fn rejects_a_stream_that_does_not_start_with_a_keyframe() {
        let broken = rewrite(&encoded(), |s| {
            s.remove(0);
        });
        assert!(run(&broken, None).unwrap_err().contains("keyframe"));
    }
}
