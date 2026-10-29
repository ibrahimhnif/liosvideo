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

    render_snapshot(&entry_file, 0, &out_png).await?;

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
