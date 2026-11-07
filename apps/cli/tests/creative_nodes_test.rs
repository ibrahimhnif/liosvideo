use anyhow::Result;
use image::GenericImageView;
use liosvideo_cli::pipeline::{render_snapshot, Preset};

fn write_project(name: &str, source: &str) -> Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join(format!("liosvideo_{name}_{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("main.ts"), source)?;
    Ok(dir)
}

#[tokio::test]
async fn renders_custom_wgsl_shader() -> Result<()> {
    let dir = write_project(
        "shader",
        r##"
        import { composition, scene, shader } from "liosvideo";

        const fx = scene("fx", { duration: 1.0 }, ({ root, width, height }) => {
            root.add(shader({
                name: "paint",
                width,
                height,
                uniforms: { speed: 2.0 },
                code: `
                    @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
                        let t = u_globals.time.x;
                        let x = mix(uv.x, u.speed.x, 0.0);
                        return vec4f(x, 0.0, 0.0, 1.0);
                    }
                `,
            }));
        });

        export default composition({ width: 64, height: 64, fps: 30, scenes: [fx] });
    "##,
    )?;

    let out = dir.join("frame.png");
    render_snapshot(&dir.join("main.ts"), 0, &out, Preset::Native).await?;

    let image = image::open(&out)?;
    let pixel = image.get_pixel(32, 32);
    assert!(pixel[0] > 100, "shader red channel: {pixel:?}");
    assert!(pixel[1] < 10, "shader green channel: {pixel:?}");

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// A shader may read only `u` (or only `u_globals`, or neither); the unused binding must not
/// break the frame.
#[tokio::test]
async fn renders_shaders_that_skip_a_binding() -> Result<()> {
    let dir = write_project(
        "shader_bindings",
        r##"
        import { composition, scene, shader } from "liosvideo";

        const fx = scene("fx", { duration: 1.0 }, ({ root, width, height }) => {
            root.add(shader({ name: "onlyU", width: width / 2, height, uniforms: { level: 0.8 },
                code: `@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f { return vec4f(0.0, u.level.x, 0.0, 1.0); }` }));
            root.add(shader({ name: "neither", x: width / 2, width: width / 2, height,
                code: `@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f { return vec4f(0.0, 0.0, 1.0, 1.0); }` }));
        });

        export default composition({ width: 64, height: 64, fps: 30, scenes: [fx] });
    "##,
    )?;

    let out = dir.join("frame.png");
    render_snapshot(&dir.join("main.ts"), 0, &out, Preset::Native).await?;

    let image = image::open(&out)?;
    let left = image.get_pixel(16, 32);
    let right = image.get_pixel(48, 32);
    assert!((left[1] as i32 - 204).abs() <= 2 && left[0] < 10, "u-only shader: {left:?}");
    assert!(right[2] > 245 && right[0] < 10, "binding-free shader: {right:?}");

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

#[tokio::test]
async fn renders_threejs_mesh_with_lights() -> Result<()> {
    let dir = write_project(
        "three",
        r##"
        import { composition, scene, three } from "liosvideo";
        import * as THREE from "three";

        const cube = scene("cube", { duration: 1.0 }, ({ root, width, height }) => {
            root.add(three({
                name: "cube3d",
                width,
                height,
                camera: "perspective",
                fov: 50,
                setup({ scene: s, camera }) {
                    camera.position.z = 4;
                    const box = new THREE.Mesh(
                        new THREE.BoxGeometry(1.5, 1.5, 1.5),
                        new THREE.MeshStandardMaterial({ color: "#3366ff", roughness: 0.4 }),
                    );
                    s.add(box);
                    const light = new THREE.DirectionalLight(0xffffff, 2.5);
                    light.position.set(2, 3, 5);
                    s.add(light);
                    s.add(new THREE.AmbientLight(0xffffff, 0.4));
                    return { box };
                },
                update({ box }, progress, time) {
                    box.rotation.y = time * 1.5;
                },
            }));
        });

        export default composition({
            width: 64,
            height: 64,
            fps: 30,
            background: "#000000",
            scenes: [cube],
        });
    "##,
    )?;

    let out = dir.join("frame.png");
    render_snapshot(&dir.join("main.ts"), 5, &out, Preset::Native).await?;

    let image = image::open(&out)?;
    let pixel = image.get_pixel(32, 32);
    assert!(
        pixel[2] > 20,
        "expected a lit blue cube at the centre, got {pixel:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

// Same scene and path as "follows a 3-key camera path" in packages/runtime/test/three_soft.test.ts.
#[tokio::test]
async fn follows_a_three_key_camera_path() -> Result<()> {
    let dir = write_project(
        "camera-path",
        r##"
        import { cameraPath, composition, scene, three } from "liosvideo";
        import * as THREE from "three";

        const shot = scene("shot", { duration: 1.2 }, ({ root, width, height }) => {
            root.add(three({
                name: "cubes",
                width,
                height,
                fov: 40,
                cameraPath: cameraPath([
                    { at: 0, position: [-3, 0, 4], target: [-3, 0, 0] },
                    { at: 0.5, position: [0, 0, 1], target: [0, 0, -3] },
                    { at: 1, position: [3, 0, 4], target: [3, 0, 0], fov: 30 },
                ]),
                setup({ scene: s }) {
                    for (const [x, z, color] of [[-3, 0, "#ff0000"], [0, -3, "#00ff00"], [3, 0, "#0000ff"]] as const) {
                        const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color }));
                        cube.position.set(x, 0, z);
                        s.add(cube);
                    }
                },
            }));
        });

        export default composition({ width: 64, height: 64, fps: 30, background: "#000000", scenes: [shot] });
    "##,
    )?;

    // One process per frame: a second three.js GPU session in the same process is not supported.
    for (frame, channel, label) in [(0, 0, "red"), (15, 1, "green"), (30, 2, "blue")] {
        let out = dir.join(format!("frame-{frame}.png"));
        let status = std::process::Command::new(env!("CARGO_BIN_EXE_liosvideo"))
            .args(["snapshot", "main.ts", "--frame", &frame.to_string(), "-o"])
            .arg(&out)
            .current_dir(&dir)
            .status()?;
        assert!(status.success(), "snapshot of frame {frame} failed");
        let pixel = image::open(&out)?.get_pixel(32, 32);
        let others = (0..3).filter(|&c| c != channel).map(|c| pixel[c]).max().unwrap();
        assert!(
            pixel[channel] > 200 && others < 60,
            "frame {frame}: expected the {label} cube at the centre, got {pixel:?}"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

// Same cutaway as "cuts meshes with material.clippingPlanes animated in update" in
// packages/runtime/test/three_soft.test.ts.
#[tokio::test]
async fn clips_a_cutaway_with_an_animated_plane() -> Result<()> {
    let dir = write_project(
        "cutaway",
        r##"
        import { composition, scene, three } from "liosvideo";
        import * as THREE from "three";

        const shot = scene("shot", { duration: 1 }, ({ root, width, height }) => {
            root.add(three({
                name: "cutaway",
                width,
                height,
                fov: 40,
                setup({ scene: s, camera }) {
                    camera.position.set(0, 0, 5);
                    const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 5);
                    const cube = new THREE.Mesh(
                        new THREE.BoxGeometry(2, 2, 2),
                        new THREE.MeshBasicMaterial({ color: "#ff0000", clippingPlanes: [plane] }),
                    );
                    s.add(cube);
                    return { plane };
                },
                update({ plane }, progress) {
                    plane.constant = 5 - 5 * progress;
                },
            }));
        });

        export default composition({ width: 64, height: 64, fps: 30, background: "#000000", scenes: [shot] });
    "##,
    )?;

    // One process per frame: a second three.js GPU session in the same process is not supported.
    for (time, right_red) in [("0", true), ("0.99", false)] {
        let out = dir.join(format!("cut-{time}.png"));
        let status = std::process::Command::new(env!("CARGO_BIN_EXE_liosvideo"))
            .args(["snapshot", "main.ts", "--time", time, "-o"])
            .arg(&out)
            .current_dir(&dir)
            .status()?;
        assert!(status.success(), "snapshot at {time}s failed");
        let image = image::open(&out)?;
        let left = image.get_pixel(22, 32);
        let right = image.get_pixel(42, 32);
        assert!(left[0] > 200, "t={time}: the left half should stay, got {left:?}");
        assert_eq!(right[0] > 200, right_red, "t={time}: right half {right:?}");
    }

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}
