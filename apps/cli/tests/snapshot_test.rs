use anyhow::Result;
use image::GenericImageView;
use liosvideo_cli::pipeline::render_snapshot;

#[tokio::test]
async fn renders_snapshot_frame_to_png() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_snap_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;

    let composition_code = r##"
        import { composition, scene, rect } from "liosvideo";

        const intro = scene("intro", { duration: 1.0, background: "#ff0000" }, ({ root, width, height }) => {
            root.add(rect({
                name: "red_card",
                width,
                height,
                fill: "#ff0000",
            }));
        });

        export default composition({
            width: 64,
            height: 64,
            fps: 30,
            background: "#ff0000",
            scenes: [intro],
        });
    "##;

    let entry_file = dir.join("test_comp.ts");
    std::fs::write(&entry_file, composition_code)?;

    let out_png = dir.join("snapshot.png");

    render_snapshot(
        &entry_file,
        0,
        &out_png,
        liosvideo_cli::pipeline::Preset::Native,
    )
    .await?;

    // 1. Verify file exists
    assert!(out_png.exists(), "Snapshot PNG file must exist");

    // 2. Verify PNG magic header
    let bytes = std::fs::read(&out_png)?;
    assert!(bytes.len() >= 8, "PNG file too short");
    assert_eq!(
        &bytes[0..8],
        &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A],
        "Valid PNG magic header required"
    );

    // 3. Open image and verify dimensions and pixel color
    let img = image::open(&out_png)?;
    assert_eq!(img.width(), 64);
    assert_eq!(img.height(), 64);

    let pixel = img.get_pixel(32, 32);
    // Red color: #ff0000 with alpha 255
    assert!(
        pixel[0] >= 250,
        "Expected high red component, got {}",
        pixel[0]
    );
    assert!(
        pixel[1] <= 5,
        "Expected low green component, got {}",
        pixel[1]
    );
    assert!(
        pixel[2] <= 5,
        "Expected low blue component, got {}",
        pixel[2]
    );
    assert_eq!(pixel[3], 255, "Expected full opacity, got {}", pixel[3]);

    // Clean up
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Same pixel properties as the desktop renderer's path tests (packages/runtime/test/gpu).
#[tokio::test]
async fn renders_paths_like_the_preview() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_path_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let composition_code = r##"
        import { composition, scene, path } from "liosvideo";

        const s = scene("s", { duration: 1.0, background: "#000000" }, ({ root }) => {
            root.add(path({ name: "tri", x: 4, y: 4, d: "M 0 0 L 56 0 L 28 40 Z", fill: "#ff0000" }));
            root.add(path({ name: "line", y: 50, d: "M 6 8 L 58 8", fill: "", stroke: "#00ff00", strokeWidth: 6 }));
        });

        export default composition({ width: 64, height: 64, fps: 30, background: "#000000", scenes: [s] });
    "##;
    let entry_file = dir.join("paths.ts");
    std::fs::write(&entry_file, composition_code)?;
    let out_png = dir.join("paths.png");
    render_snapshot(
        &entry_file,
        0,
        &out_png,
        liosvideo_cli::pipeline::Preset::Native,
    )
    .await?;
    let img = image::open(&out_png)?.to_rgba8();

    // filled triangle: red inside, transparent at the bound-box corners
    let inside = img.get_pixel(32, 16).0;
    assert!(
        inside[0] > 240 && inside[1] < 10,
        "expected red fill, got {inside:?}"
    );
    assert_eq!(img.get_pixel(6, 42).0, [0, 0, 0, 255]);
    assert_eq!(img.get_pixel(58, 42).0, [0, 0, 0, 255]);

    // stroke-only path: a green line at y = 58 and nothing above it
    let line = img.get_pixel(32, 58).0;
    assert!(
        line[1] > 240 && line[0] < 10,
        "expected green stroke, got {line:?}"
    );
    assert_eq!(img.get_pixel(32, 50).0, [0, 0, 0, 255]);

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Same pixel properties as the desktop renderer's filter tests (packages/runtime/test/gpu).
#[tokio::test]
async fn renders_filters_like_the_preview() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_filter_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let composition_code = r##"
        import { composition, scene, group, rect } from "liosvideo";

        const s = scene("s", { duration: 1.0 }, ({ root }) => {
            const ramp = root.add(group({ name: "ramp", pixelate: 8 }));
            for (let i = 0; i < 16; i++) {
                const v = Math.round((i * 4 * 255) / 64).toString(16).padStart(2, "0");
                ramp.add(rect({ name: `s${i}`, x: i * 4, width: 4, height: 32, fill: `#${v}4020` }));
            }
            root.add(group({ name: "ink", outline: 2, outlineColor: "#00ff00" }))
                .add(rect({ name: "box", x: 27, y: 42, width: 10, height: 10, fill: "#ffffff" }));
        });

        export default composition({ width: 64, height: 64, fps: 30, background: "#000000", scenes: [s] });
    "##;
    let entry_file = dir.join("filters.ts");
    std::fs::write(&entry_file, composition_code)?;
    let out_png = dir.join("filters.png");
    render_snapshot(
        &entry_file,
        0,
        &out_png,
        liosvideo_cli::pipeline::Preset::Native,
    )
    .await?;
    let img = image::open(&out_png)?.to_rgba8();

    // pixelate: every 8×8 cell of the ramp is one colour, and the ramp still ramps
    for cx in (0..64).step_by(8) {
        let first = img.get_pixel(cx, 8).0;
        for dx in 0..8 {
            for dy in 0..8 {
                let p = img.get_pixel(cx + dx, 8 + dy).0;
                let d = (0..3)
                    .map(|i| (p[i] as i32 - first[i] as i32).abs())
                    .max()
                    .unwrap();
                assert!(d <= 1, "cell at {cx} not uniform: {p:?} vs {first:?}");
            }
        }
    }
    assert!(img.get_pixel(60, 8).0[0] as i32 - img.get_pixel(0, 8).0[0] as i32 > 100);

    // outline: green ink 1 px left of the box, white inside, black further out
    let edge = img.get_pixel(26, 47).0;
    assert!(
        edge[1] > 150 && edge[0] < 80,
        "expected green ink, got {edge:?}"
    );
    assert!(img.get_pixel(32, 47).0[0] > 240);
    assert_eq!(img.get_pixel(15, 47).0, [0, 0, 0, 255]);

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Bloom: `glowThreshold` haloes only what is brighter than it (the desktop test in packages/runtime/test/gpu).
#[tokio::test]
async fn blooms_only_the_bright_parts() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_bloom_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let composition_code = r##"
        import { composition, scene, group, rect } from "liosvideo";

        const s = scene("s", { duration: 1.0 }, ({ root }) => {
            const bloom = root.add(group({ name: "bloom", width: 128, height: 64, glow: 8, glowThreshold: 0.6 }));
            bloom.add(rect({ name: "bright", x: 20, y: 27, width: 10, height: 10, fill: "#ffffff" }));
            bloom.add(rect({ name: "dim", x: 90, y: 27, width: 10, height: 10, fill: "#606060" }));
        });

        export default composition({ width: 128, height: 64, fps: 30, background: "#000000", scenes: [s] });
    "##;
    let entry_file = dir.join("bloom.ts");
    std::fs::write(&entry_file, composition_code)?;
    let out_png = dir.join("bloom.png");
    render_snapshot(
        &entry_file,
        0,
        &out_png,
        liosvideo_cli::pipeline::Preset::Native,
    )
    .await?;
    let img = image::open(&out_png)?.to_rgba8();
    let lum = |x: u32, y: u32| {
        let p = img.get_pixel(x, y).0;
        0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32
    };
    assert!(lum(14, 32) > 13.0, "expected a halo beside the white square, got {}", lum(14, 32));
    assert!(lum(84, 32) < 1.0, "expected no halo beside the grey square, got {}", lum(84, 32));
    let grey = lum(95, 32);
    assert!(grey > 90.0 && grey < 100.0, "the grey square is kept as is, got {grey}");

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Same pixel properties as the desktop renderer's sticker test (packages/runtime/test/gpu).
#[tokio::test]
async fn draws_a_sticker_line_like_the_preview() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("liosvideo_sticker_test_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let composition_code = r##"
        import { composition, scene, group, rect } from "liosvideo";

        const s = scene("s", { duration: 1.0 }, ({ root }) => {
            root.add(group({ name: "cut", sticker: 6, stickerGap: 6, stickerWobble: 0 }))
                .add(rect({ name: "box", x: 88, y: 88, width: 80, height: 80, fill: "#ff0000" }));
        });

        export default composition({ width: 256, height: 256, fps: 30, background: "#000000", scenes: [s] });
    "##;
    let entry_file = dir.join("sticker.ts");
    std::fs::write(&entry_file, composition_code)?;
    let out_png = dir.join("sticker.png");
    render_snapshot(&entry_file, 0, &out_png, liosvideo_cli::pipeline::Preset::Native).await?;
    let img = image::open(&out_png)?.to_rgba8();
    let lum = |x: u32, y: u32| {
        let p = img.get_pixel(x, y).0;
        (p[0] as u32 + p[1] as u32 + p[2] as u32) / 3
    };
    let inside = img.get_pixel(128, 128).0;
    assert!(inside[0] > 250 && inside[1] < 5, "shape changed: {inside:?}");
    assert!(lum(128, 85) < 40, "gap should stay background, got {}", lum(128, 85));
    assert!(lum(128, 79) > 200, "expected the white line, got {}", lum(128, 79));
    assert!(lum(128, 70) < 40, "nothing beyond the line, got {}", lum(128, 70));
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// A packed cut-out (`liosvideo asset matte`): colour on top, mask below at half height.
#[tokio::test]
async fn cuts_out_a_packed_matte_video() -> Result<()> {
    use liosvideo_cli::media::encoder::{Mp4Encoder, VideoEncoderKind};
    let dir = std::env::temp_dir().join(format!("liosvideo_matte_test_{}", std::process::id()));
    std::fs::create_dir_all(dir.join("assets/video"))?;
    // 64×96: 64×64 green picture over a 64×32 mask whose left half is white
    let (w, h) = (64u32, 96u32);
    let mut frame = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            let px = if y < 64 { [0, 255, 0] } else if x < 32 { [255, 255, 255] } else { [0, 0, 0] };
            frame[i..i + 3].copy_from_slice(&px);
            frame[i + 3] = 255;
        }
    }
    let mut enc = Mp4Encoder::new_with_encoder(
        &dir.join("assets/video/clip.matte.mp4"), w, h, 30.0, 48000, 4_000_000, 128_000, VideoEncoderKind::Software,
    )?;
    for _ in 0..30 {
        enc.push_frame(&frame)?;
    }
    enc.finish()?;

    let composition_code = r##"
        import { composition, scene, video } from "liosvideo";
        const s = scene("s", { duration: 1.0 }, ({ root }) => {
            root.add(video({ src: "assets/video/clip.mp4", matte: true, width: 160, height: 160 }));
        });
        export default composition({ width: 256, height: 256, fps: 30, background: "#0000ff", scenes: [s] });
    "##;
    let entry_file = dir.join("matte.ts");
    std::fs::write(&entry_file, composition_code)?;
    let out_png = dir.join("matte.png");
    render_snapshot(&entry_file, 3, &out_png, liosvideo_cli::pipeline::Preset::Native).await?;
    let img = image::open(&out_png)?.to_rgba8();
    let kept = img.get_pixel(30, 80).0;
    assert!(kept[1] > 200 && kept[0] < 60, "left half should show the picture, got {kept:?}");
    let cut = img.get_pixel(130, 80).0;
    // fully clear, not faintly covered: a sticker line would fill any leftover alpha
    assert!(cut[0] <= 2 && cut[1] <= 2 && cut[2] >= 252, "right half should show the background, got {cut:?}");
    // the box shows the picture only, not the mask under it
    let bottom = img.get_pixel(30, 150).0;
    assert!(bottom[1] > 200, "the picture should reach y = 160, got {bottom:?}");
    assert_eq!(img.get_pixel(30, 200).0, [0, 0, 255, 255]);
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}
