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

fn centroid(image: &image::DynamicImage, pick: impl Fn(image::Rgba<u8>) -> bool) -> Option<(f32, f32)> {
    let (mut sx, mut sy, mut n) = (0.0, 0.0, 0.0);
    for (x, y, pixel) in image.pixels() {
        if pick(pixel) {
            sx += x as f32;
            sy += y as f32;
            n += 1.0;
        }
    }
    (n > 0.0).then(|| (sx / n, sy / n))
}

#[tokio::test]
async fn keeps_a_callout_on_its_part_during_an_orbit() -> Result<()> {
    let dir = write_project(
        "callout",
        r##"
        import { callout, composition, orbit, scene, three } from "liosvideo";
        import * as THREE from "three";

        const shot = scene("shot", { duration: 1 }, ({ root, width, height }) => {
            const stage = root.add(three({
                name: "stage",
                width,
                height,
                fov: 40,
                cameraPath: orbit({ target: [0, 0, 0], radius: 6, height: 1, from: -0.5, to: 1.2, start: 0, end: 1, ease: "linear" }),
                setup({ scene: s }) {
                    const part = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), new THREE.MeshBasicMaterial({ color: "#ff0000" }));
                    part.position.set(0.9, 0.4, 0.2);
                    s.add(part);
                },
            }));
            // only the dot is measured: no leader line, and a label in the background colour
            callout(stage, { target: [0.9, 0.4, 0.2], label: "Grill", offset: [0, 0], color: "#000000", accent: "#00ff00" });
        });

        export default composition({ width: 160, height: 160, fps: 30, background: "#000000", scenes: [shot] });
    "##,
    )?;

    let mut parts = Vec::new();
    // One process per frame: a second three.js GPU session in the same process is not supported.
    for frame in [0, 15, 29] {
        let out = dir.join(format!("callout-{frame}.png"));
        let status = std::process::Command::new(env!("CARGO_BIN_EXE_liosvideo"))
            .args(["snapshot", "main.ts", "--frame", &frame.to_string(), "-o"])
            .arg(&out)
            .current_dir(&dir)
            .status()?;
        assert!(status.success(), "snapshot of frame {frame} failed");
        let image = image::open(&out)?;
        let part = centroid(&image, |p| p[0] > 150 && p[1] < 90 && p[2] < 90).expect("the red part is drawn");
        let dot = centroid(&image, |p| p[1] > 150 && p[0] < 90 && p[2] < 90).expect("the callout dot is drawn");
        let gap = ((part.0 - dot.0).powi(2) + (part.1 - dot.1).powi(2)).sqrt();
        assert!(gap < 2.0, "frame {frame}: callout dot {dot:?} is {gap:.1}px from the part {part:?}");
        parts.push(part);
    }
    // the part really moves across the frame during the orbit
    assert!((parts[0].0 - parts[2].0).abs() > 10.0, "the orbit should move the part: {parts:?}");

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

// Same seeded field as "draws the same seeded particles" in packages/runtime/test/three_soft.test.ts
// and test/gpu/creative.browser.test.ts: the bright pixels land in the same place in every renderer.
#[tokio::test]
async fn draws_the_same_seeded_particles() -> Result<()> {
    let dir = write_project(
        "particles",
        r##"
        import { composition, particles, scene, three } from "liosvideo";
        import * as THREE from "three";

        const shot = scene("shot", { duration: 4 }, ({ root }) => {
            root.add(three({
                name: "dust",
                width: 96,
                height: 96,
                fov: 40,
                setup({ scene: s, camera }) {
                    s.background = new THREE.Color("#000000");
                    const dust = particles({ count: 6, seed: 11, area: [3, 2, 0.5], velocity: [0, 0, 0], spread: 0, turbulence: 0, size: 0.4, lifetime: 10, fade: 0.1, color: "#ffffff" });
                    s.add(dust.object);
                    return { dust, camera };
                },
                update({ dust, camera }, _progress, time) {
                    dust.update(time, camera);
                },
            }));
        });

        export default composition({ width: 96, height: 96, fps: 30, background: "#000000", scenes: [shot] });
    "##,
    )?;

    let out = dir.join("dust.png");
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_liosvideo"))
        .args(["snapshot", "main.ts", "--time", "2", "-o"])
        .arg(&out)
        .current_dir(&dir)
        .status()?;
    assert!(status.success(), "snapshot failed");
    let image = image::open(&out)?;
    let n = image.pixels().filter(|(_, _, p)| p[0] > 60).count() as f32;
    let (x, y) = centroid(&image, |p| p[0] > 60).expect("particles are drawn");
    assert!((x - 39.2).abs() < 1.0 && (y - 42.9).abs() < 1.0, "centroid ({x:.1}, {y:.1})");
    assert!(n > 426.0 * 0.7 && n < 426.0 * 1.3, "{n} bright pixels");

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Depth of field: the same square as packages/runtime/test/dof.test.ts and the desktop browser
/// test; sharp when the focus is on it, soft-edged when the focus is far behind it.
#[tokio::test]
async fn blurs_what_is_out_of_focus() -> Result<()> {
    let dir = write_project(
        "dof",
        r##"
        import { composition, scene, three } from "liosvideo";
        import * as THREE from "three";

        const shot = (focus) => scene(`focus-${focus}`, { duration: 1 }, ({ root }) => {
            root.add(three({
                name: "lens",
                width: 64,
                height: 64,
                fov: 40,
                depthOfField: { focus, aperture: 0.15, samples: 12 },
                setup({ scene: s, camera }) {
                    s.background = new THREE.Color("#000000");
                    camera.position.set(0, 0, 3);
                    camera.lookAt(0, 0, 0);
                    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
                    plane.position.y = 0.3;
                    s.add(plane);
                },
            }));
        });

        export default composition({ width: 64, height: 64, fps: 30, background: "#000000", scenes: [shot(3), shot(12)] });
    "##,
    )?;

    let soft = |time: &str| -> Result<(usize, u8, u8)> {
        let out = dir.join(format!("lens-{time}.png"));
        let status = std::process::Command::new(env!("CARGO_BIN_EXE_liosvideo"))
            .args(["snapshot", "main.ts", "--time", time, "-o"])
            .arg(&out)
            .current_dir(&dir)
            .status()?;
        assert!(status.success(), "snapshot failed");
        let image = image::open(&out)?.to_rgba8();
        let n = (0..64)
            .filter(|&x| {
                let v = image.get_pixel(x, 20).0[0];
                v > 20 && v < 235
            })
            .count();
        Ok((n, image.get_pixel(32, 20).0[0], image.get_pixel(32, 52).0[0]))
    };
    let (sharp, top, bottom) = soft("0.5")?;
    assert!(sharp <= 4, "{sharp} soft pixels in focus");
    assert!(top > 200 && bottom < 20, "in focus: top {top}, bottom {bottom}");
    let (blurred, top, bottom) = soft("1.5")?;
    assert!(blurred > 6, "{blurred} soft pixels out of focus");
    assert!(top > 150 && bottom < 20, "out of focus: top {top}, bottom {bottom}");

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}
