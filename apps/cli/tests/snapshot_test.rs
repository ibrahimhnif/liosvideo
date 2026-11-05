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
