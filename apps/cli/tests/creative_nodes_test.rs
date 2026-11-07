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
