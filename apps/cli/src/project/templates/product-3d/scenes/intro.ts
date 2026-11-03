import { circle, scene, text, three, vo } from "liosvideo";
import * as THREE from "three";
import { theme } from "../theme";

export default scene("intro", { duration: 3.5, background: theme.colors.bg }, ({ root, width, height }) => {
  // Ambient radial glow circle
  root.add(
    circle({
      name: "backdrop-glow",
      radius: Math.min(width, height) * 0.35,
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      fill: theme.colors.surface,
      opacity: 0.8
    })
  );

  // 3D Mesh
  const hero3d = root.add(
    three({
      name: "hero-3d",
      width: Math.min(width * 0.5, 600),
      height: Math.min(width * 0.5, 600),
      x: width / 2,
      y: height / 2,
      anchorX: 0.5,
      anchorY: 0.5,
      camera: "perspective",
      fov: 45,
      opacity: 0,
      scaleX: 0.8,
      scaleY: 0.8,
      setup({ scene, camera }) {
        camera.position.set(0, 0, 4.5);
        const geom = new THREE.IcosahedronGeometry(1.4, 2);
        const mat = new THREE.MeshStandardMaterial({
          color: theme.colors.primary,
          wireframe: true,
          roughness: 0.1
        });
        const mesh = new THREE.Mesh(geom, mat);
        scene.add(mesh);

        const light1 = new THREE.DirectionalLight(0xffffff, 2.5);
        light1.position.set(2, 3, 4);
        scene.add(light1);
        scene.add(new THREE.AmbientLight(0x0f172a, 1.2));
        return { mesh };
      },
      update({ mesh }, progress, time) {
        mesh.rotation.x = time * 0.5;
        mesh.rotation.y = time * 1.0;
      }
    })
  );
  hero3d.to({ opacity: 1, scaleX: 1, scaleY: 1 }, { at: 0.2, duration: 0.6, ease: theme.easing.pop });

  // Title
  const title = root.add(
    text({
      name: "headline",
      text: "Next-Gen 3D Graphics Engine",
      fontSize: Math.min(width * 0.042, 48),
      fontWeight: 700,
      color: theme.colors.text,
      x: width / 2,
      y: height * 0.82,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0
    })
  );
  title.to({ opacity: 1 }, { at: 0.4, duration: 0.5, ease: theme.easing.smooth });

  const voice = vo("intro-1");
  if (voice.isReady) {
    const wordHit = voice.wordTime("graphics");
    if (wordHit !== undefined) {
      title.to({ color: theme.colors.primary }, { at: wordHit, duration: 0.2 });
    }
  }
});
