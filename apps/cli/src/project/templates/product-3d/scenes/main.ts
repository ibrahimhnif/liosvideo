import { rect, scene, text, three, vo } from "liosvideo";
import * as THREE from "three";
import { theme } from "../theme";

export default scene("main", { duration: 6, background: theme.colors.bg }, ({ root, width, height }) => {
  // 3D Canvas
  const hero3d = root.add(
    three({
      name: "hero-mesh",
      width: Math.min(width * 0.45, 560),
      height: Math.min(width * 0.45, 560),
      x: width * 0.35,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      camera: "perspective",
      fov: 45,
      setup({ scene, camera }) {
        camera.position.set(0, 0, 4);
        const geom = new THREE.TorusKnotGeometry(1.1, 0.35, 128, 32);
        const mat = new THREE.MeshStandardMaterial({
          color: theme.colors.primary,
          roughness: 0.2,
          metalness: 0.8
        });
        const mesh = new THREE.Mesh(geom, mat);
        scene.add(mesh);

        const light1 = new THREE.DirectionalLight(0xffffff, 2.5);
        light1.position.set(3, 4, 5);
        scene.add(light1);

        const light2 = new THREE.DirectionalLight(0x818cf8, 1.8);
        light2.position.set(-3, -2, 2);
        scene.add(light2);

        scene.add(new THREE.AmbientLight(0x0f172a, 1.0));
        return { mesh };
      },
      update({ mesh }, progress, time) {
        mesh.rotation.x = time * 0.7;
        mesh.rotation.y = time * 1.1;
      }
    })
  );

  // Floating spec chips
  const specs = ["WebGPU Native", "Offscreen Three.js", "Deterministic Sync"];
  specs.forEach((label, i) => {
    const chip = root.add(
      rect({
        name: `spec-chip-${i}`,
        width: 250,
        height: 52,
        x: width * 0.72,
        y: height * 0.36 + i * 74,
        anchorX: 0.5,
        anchorY: 0.5,
        radius: 12,
        fill: theme.colors.surface,
        stroke: theme.colors.border,
        strokeWidth: 1.5,
        opacity: 0,
        scaleX: 0.9,
        scaleY: 0.9
      })
    );

    chip.add(
      text({
        name: "label",
        text: label,
        fontSize: 16,
        fontWeight: 600,
        color: theme.colors.text,
        x: chip.width / 2,
        y: chip.height / 2,
        anchorX: 0.5,
        anchorY: 0.5
      })
    );

    chip.to(
      { opacity: 1, scaleX: 1, scaleY: 1 },
      { at: 0.6 + i * 0.25, duration: 0.5, ease: theme.easing.pop }
    );
  });
});
