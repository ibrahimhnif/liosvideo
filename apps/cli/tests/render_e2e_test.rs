use anyhow::Result;
use liosvideo_cli::pipeline::{run_info_job, run_render_job, RenderConfig};
use mp4::{FourCC, TrackType};
use std::fs::File;

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
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
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

#[tokio::test]
async fn renders_composition_with_audio_to_mp4() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_e2e_test_{}", std::process::id()));
    let audio_dir = dir.join("assets/audio/music");
    std::fs::create_dir_all(&audio_dir)?;

    // Create a 1.0 second test audio file (48kHz stereo sine wave)
    let sample_rate = 48_000;
    let num_samples = sample_rate; // 1.0 second
    let mut pcm = Vec::with_capacity(num_samples as usize * 2);
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let s = ((2.0 * std::f32::consts::PI * 440.0 * t).sin() * 10000.0) as i16;
        pcm.push(s); // left
        pcm.push(s); // right
    }
    let wav_bytes = create_test_wav(sample_rate, 2, &pcm);
    let wav_path = audio_dir.join("bgm.wav");
    std::fs::write(&wav_path, wav_bytes)?;

    // Write multi-scene composition (30 frames at 30 fps = 1.0 second)
    let comp_code = r##"
        import { composition, scene, rect } from "liosvideo";

        const intro = scene("intro", { duration: 0.5 }, ({ root, width, height }) => {
            root.add(rect({
                name: "red_box",
                width: width * 0.5,
                height: height * 0.5,
                fill: "#ff0000",
            }));
        });

        const outro = scene("outro", { duration: 0.5 }, ({ root, width, height }) => {
            root.add(rect({
                name: "blue_box",
                width,
                height,
                fill: "#0000ff",
            }));
        });

        export default composition({
            width: 128,
            height: 128,
            fps: 30,
            background: "#101010",
            scenes: [intro, outro],
            audio: [
                {
                    id: "bgm",
                    src: "assets/audio/music/bgm.wav",
                    startAt: 0,
                    volume: 0.8,
                    loop: true,
                }
            ],
        });
    "##;

    let entry_file = dir.join("video.ts");
    std::fs::write(&entry_file, comp_code)?;

    let out_mp4 = dir.join("out/rendered.mp4");

    let config = RenderConfig {
        entry: entry_file.clone(),
        out: out_mp4.clone(),
        fps: None,
        frames: None,
        quality: "medium".to_string(),
        quiet: true,
    };

    // 1. Run render job
    run_render_job(config).await?;

    // 2. Assert output file exists and is non-empty
    assert!(out_mp4.exists(), "Rendered MP4 file should exist");
    let file = File::open(&out_mp4)?;
    let file_size = file.metadata()?.len();
    assert!(
        file_size > 1000,
        "Rendered MP4 file should be substantial, got {file_size} bytes"
    );

    // 3. Inspect using mp4::Mp4Reader
    let reader = mp4::Mp4Reader::read_header(file, file_size)?;
    assert_eq!(reader.ftyp.major_brand, FourCC::from(*b"isom"));

    let tracks = reader.tracks();
    // Must contain both video and audio tracks
    assert_eq!(tracks.len(), 2, "Expected 2 tracks: Video and Audio");

    let video_track = tracks
        .values()
        .find(|t| t.track_type().ok() == Some(TrackType::Video))
        .expect("Should contain a video track");
    assert_eq!(video_track.width(), 128);
    assert_eq!(video_track.height(), 128);

    let audio_track = tracks
        .values()
        .find(|t| t.track_type().ok() == Some(TrackType::Audio))
        .expect("Should contain an audio track");
    assert_eq!(audio_track.track_type()?, TrackType::Audio);

    // 4. Test run_info_job
    run_info_job(&entry_file, false).await?;
    run_info_job(&entry_file, true).await?;

    // Clean up
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

#[tokio::test]
async fn renders_frame_range_subset() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_range_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;

    let comp_code = r##"
        import { composition, scene, rect } from "liosvideo";

        const intro = scene("intro", { duration: 1.0 }, ({ root, width, height }) => {
            root.add(rect({
                name: "box",
                width,
                height,
                fill: "#00ff00",
            }));
        });

        export default composition({
            width: 64,
            height: 64,
            fps: 30,
            scenes: [intro],
        });
    "##;

    let entry_file = dir.join("range_comp.ts");
    std::fs::write(&entry_file, comp_code)?;

    let out_mp4 = dir.join("range.mp4");

    let config = RenderConfig {
        entry: entry_file,
        out: out_mp4.clone(),
        fps: None,
        frames: Some("0..10".to_string()),
        quality: "medium".to_string(),
        quiet: true,
    };

    run_render_job(config).await?;

    assert!(out_mp4.exists(), "Output MP4 should exist");
    let file = File::open(&out_mp4)?;
    let file_size = file.metadata()?.len();
    let reader = mp4::Mp4Reader::read_header(file, file_size)?;

    // Video only track
    assert_eq!(reader.tracks().len(), 1);

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}
