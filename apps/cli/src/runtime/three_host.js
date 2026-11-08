// Deterministic software rasteriser for `three(...)` nodes.
//
// Runs the user's `setup` / `update` callbacks against the real three.js scene graph,
// then rasterises BufferGeometry meshes with three's standard materials and lights
// into an RGBA buffer handed back to Rust through `op_three_frame`.
//
// Supported: Mesh (BufferGeometry, indexed or not, groups/multi-material), Line,
// LineSegments, LineLoop, Points, MeshBasic/Lambert/Phong/Standard/Toon/Normal,
// Ambient/Hemisphere/Directional/Point/Spot lights, vertex colors, flat shading,
// FrontSide/BackSide/DoubleSide, transparent materials, material.clippingPlanes (meshes), orthographic + perspective cameras.
// Not supported: textures, shadows, skinning, morph targets, instancing, post-processing.

import * as THREE from "three";
import { createThreeLoaders } from "liosvideo://three-loaders";

// gltf() / hdr() / texture() read project files and decode images in Rust
globalThis.__liosvideo.registerThreeLoaders(
  createThreeLoaders({
    read: async (src) => Deno.core.ops.op_read_asset(src),
    decodeImage: async (bytes) => {
      const out = Deno.core.ops.op_decode_image(bytes);
      const view = new DataView(out.buffer, out.byteOffset, 8);
      return { width: view.getUint32(0, true), height: view.getUint32(4, true), data: out.subarray(8) };
    },
  }),
);

const sessions = new Map();
const failed = new Set();
const warned = new Set();

const FRONT = 0;
const BACK = 1;
const DOUBLE = 2;

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[three] ${message}`);
}

function walk(node, out) {
  if (!node) return;
  if (node.kind === "three") out.push(node);
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) walk(children[i], out);
}

async function createSession(node, props, width, height) {
  const scene = new THREE.Scene();
  const orthographic = props.camera === "orthographic";
  const camera = orthographic
    ? new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000)
    : new THREE.PerspectiveCamera(props.fov || 50, width / height, 0.1, 1000);
  camera.position.z = orthographic ? 500 : 5;

  if (props.shadows || (props.toneMapping && props.toneMapping !== "none")) {
    warnOnce("shadows and toneMapping need the GPU renderer; the software rasteriser ignores them");
  }
  let userState = undefined;
  if (typeof node.setupFn === "function") {
    // setup may be async (gltf / hdr / texture loads)
    userState = await node.setupFn({ scene, camera, width, height });
  }
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.updateProjectionMatrix();

  return { scene, camera, userState, width, height };
}

/** Runs setup (awaiting async setup) for the scene's three() nodes that have no session yet. */
export async function prepareThreeScene(comp, sceneIndex, time) {
  const def = comp && comp.scenes ? comp.scenes[sceneIndex] : undefined;
  if (!def) return;
  const root = globalThis.__liosvideo.instantiateScene(comp, def);
  const nodes = [];
  walk(root, nodes);
  for (const node of nodes) {
    if (sessions.has(node.path()) || failed.has(node.path())) continue;
    const props = node.propsAt(time);
    const width = Math.max(1, Math.round(props.width || 400));
    const height = Math.max(1, Math.round(props.height || 300));
    try {
      sessions.set(node.path(), await createSession(node, props, width, height));
    } catch (error) {
      failed.add(node.path());
      warnOnce(`setup() failed: ${error && error.message ? error.message : error}`);
    }
  }
}

export function renderThreeScene(comp, sceneIndex, time, progress) {
  const def = comp && comp.scenes ? comp.scenes[sceneIndex] : undefined;
  if (!def) return;
  const root = globalThis.__liosvideo.instantiateScene(comp, def);
  const nodes = [];
  walk(root, nodes);
  if (nodes.length === 0) return;

  for (const node of nodes) {
    const props = node.propsAt(time);
    const width = Math.max(1, Math.round(props.width || 400));
    const height = Math.max(1, Math.round(props.height || 300));

    let session = sessions.get(node.path());
    if (!session) {
      // prepareThreeScene runs setup first; a node it could not set up draws nothing
      continue;
    } else if (session.width !== width || session.height !== height) {
      session.width = width;
      session.height = height;
      if (session.camera.isPerspectiveCamera) session.camera.aspect = width / height;
      session.camera.updateProjectionMatrix();
    }

    if (typeof node.updateFn === "function") {
      try {
        node.updateFn(session.userState, progress, time);
      } catch (error) {
        warnOnce(`update() failed: ${error && error.message ? error.message : error}`);
      }
    }

    let pixels;
    try {
      // one pass, or one per depth-of-field sample, averaged (as the desktop renderers do)
      const passes = node.lensPasses(session.camera, time, height);
      const average = passes.length > 1 ? globalThis.__liosvideo.pixelAverage(width * height * 4) : null;
      for (const pass of passes) {
        const restore = pass();
        try {
          pixels = rasterize(session.scene, session.camera, width, height);
        } finally {
          restore();
        }
        average?.add(pixels);
      }
      if (average) pixels = average.result();
    } catch (error) {
      warnOnce(`render failed: ${error && error.message ? error.message : error}`);
      pixels = new Uint8Array(width * height * 4);
    }
    Deno.core.ops.op_three_frame(node.path(), width, height, pixels);
  }
}

// ---------------------------------------------------------------- rasteriser

function rasterize(scene, camera, width, height) {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.updateProjectionMatrix();

  const vp = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const cameraPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);

  const color = new Float32Array(width * height * 3);
  const alpha = new Float32Array(width * height);
  const depth = new Float32Array(width * height);
  depth.fill(Infinity);

  const background = readColor(scene.background);
  if (background) {
    for (let i = 0; i < width * height; i++) {
      color[i * 3] = background[0];
      color[i * 3 + 1] = background[1];
      color[i * 3 + 2] = background[2];
      alpha[i] = 1;
    }
  }

  const lights = collectLights(scene);
  const opaque = [];
  const transparent = [];
  const lines = [];
  const points = [];

  scene.traverseVisible((object) => {
    if (object.isMesh) collectMesh(object, vp, lights, cameraPos, opaque, transparent);
    else if (object.isLine || object.isLineSegments || object.isLineLoop) {
      collectLine(object, vp, lines);
    } else if (object.isPoints) collectPoints(object, vp, points);
  });

  for (const triangle of opaque) drawTriangle(triangle, color, alpha, depth, width, height, false);
  transparent.sort((a, b) => b.sortZ - a.sortZ);
  for (const triangle of transparent) {
    drawTriangle(triangle, color, alpha, depth, width, height, true);
  }
  for (const line of lines) drawLine(line, color, alpha, depth, width, height);
  for (const point of points) drawPoint(point, color, alpha, depth, width, height);

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = Math.min(1, Math.max(0, alpha[i]));
    rgba[i * 4] = Math.round(srgb(color[i * 3]) * 255 * a);
    rgba[i * 4 + 1] = Math.round(srgb(color[i * 3 + 1]) * 255 * a);
    rgba[i * 4 + 2] = Math.round(srgb(color[i * 3 + 2]) * 255 * a);
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return rgba;
}

function readColor(value) {
  if (!value) return null;
  if (value.isColor) return [value.r, value.g, value.b];
  return null;
}

function srgb(value) {
  const x = Math.min(1, Math.max(0, value));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function collectLights(scene) {
  const lights = [];
  scene.traverseVisible((object) => {
    if (object.isAmbientLight) {
      lights.push({ type: "ambient", color: object.color, intensity: object.intensity });
    } else if (object.isHemisphereLight) {
      lights.push({
        type: "hemisphere",
        sky: object.color,
        ground: object.groundColor,
        intensity: object.intensity,
      });
    } else if (object.isDirectionalLight) {
      const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      const target = new THREE.Vector3();
      object.target.getWorldPosition(target);
      lights.push({
        type: "directional",
        direction: position.sub(target).normalize(),
        color: object.color,
        intensity: object.intensity,
      });
    } else if (object.isSpotLight) {
      const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      const target = new THREE.Vector3();
      object.target.getWorldPosition(target);
      lights.push({
        type: "spot",
        position,
        direction: position.clone().sub(target).normalize(),
        color: object.color,
        intensity: object.intensity,
        distance: object.distance || 0,
        decay: object.decay || 2,
        angle: object.angle,
        penumbra: object.penumbra,
      });
    } else if (object.isPointLight) {
      const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      lights.push({
        type: "point",
        position,
        color: object.color,
        intensity: object.intensity,
        distance: object.distance || 0,
        decay: object.decay || 2,
      });
    }
  });
  return lights;
}

function collectMesh(mesh, vp, lights, cameraPos, opaque, transparent) {
  const geometry = mesh.geometry;
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return;

  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const colorAttribute = geometry.attributes.color;
  const count = position.count;
  const model = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(model);

  const world = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const clip = new Float32Array(count * 4);
  const vector = new THREE.Vector3();
  const vector4 = new THREE.Vector4();

  for (let i = 0; i < count; i++) {
    vector.fromBufferAttribute(position, i).applyMatrix4(model);
    world[i * 3] = vector.x;
    world[i * 3 + 1] = vector.y;
    world[i * 3 + 2] = vector.z;

    if (normal) {
      vector.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      normals[i * 3] = vector.x;
      normals[i * 3 + 1] = vector.y;
      normals[i * 3 + 2] = vector.z;
    }

    vector4
      .set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2], 1)
      .applyMatrix4(vp);
    clip[i * 4] = vector4.x;
    clip[i * 4 + 1] = vector4.y;
    clip[i * 4 + 2] = vector4.z;
    clip[i * 4 + 3] = vector4.w;
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const index = geometry.index ? geometry.index.array : null;
  const triangleCount = index ? index.length : count;
  const groups =
    geometry.groups && geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: triangleCount, materialIndex: 0 }];

  for (const group of groups) {
    const material = materials[group.materialIndex || 0] || materials[0];
    if (!material) continue;
    const start = group.start || 0;
    const end = Math.min(start + (group.count || triangleCount), triangleCount);

    for (let i = start; i + 2 < end; i += 3) {
      const ia = index ? index[i] : i;
      const ib = index ? index[i + 1] : i + 1;
      const ic = index ? index[i + 2] : i + 2;
      const triangle = buildTriangle(
        ia,
        ib,
        ic,
        world,
        normals,
        clip,
        colorAttribute,
        material,
        lights,
        cameraPos,
        mesh,
      );
      if (!triangle) continue;
      if (triangle.transparent) transparent.push(triangle);
      else opaque.push(triangle);
    }
  }
}

function buildTriangle(
  ia,
  ib,
  ic,
  world,
  normals,
  clip,
  colorAttribute,
  material,
  lights,
  cameraPos,
  mesh,
) {
  const w0 = clip[ia * 4 + 3];
  const w1 = clip[ib * 4 + 3];
  const w2 = clip[ic * 4 + 3];
  if (w0 <= 1e-5 || w1 <= 1e-5 || w2 <= 1e-5) return null;

  const x0 = (clip[ia * 4] / w0) * 0.5 + 0.5;
  const y0 = 0.5 - (clip[ia * 4 + 1] / w0) * 0.5;
  const z0 = clip[ia * 4 + 2] / w0;
  const x1 = (clip[ib * 4] / w1) * 0.5 + 0.5;
  const y1 = 0.5 - (clip[ib * 4 + 1] / w1) * 0.5;
  const z1 = clip[ib * 4 + 2] / w1;
  const x2 = (clip[ic * 4] / w2) * 0.5 + 0.5;
  const y2 = 0.5 - (clip[ic * 4 + 1] / w2) * 0.5;
  const z2 = clip[ic * 4 + 2] / w2;

  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) return null;

  const faceNormal = new THREE.Vector3();
  const ax = world[ib * 3] - world[ia * 3];
  const ay = world[ib * 3 + 1] - world[ia * 3 + 1];
  const az = world[ib * 3 + 2] - world[ia * 3 + 2];
  const bx = world[ic * 3] - world[ia * 3];
  const by = world[ic * 3 + 1] - world[ia * 3 + 1];
  const bz = world[ic * 3 + 2] - world[ia * 3 + 2];
  faceNormal.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  if (faceNormal.lengthSq() > 1e-12) faceNormal.normalize();
  const cx = (world[ia * 3] + world[ib * 3] + world[ic * 3]) / 3;
  const cy = (world[ia * 3 + 1] + world[ib * 3 + 1] + world[ic * 3 + 1]) / 3;
  const cz = (world[ia * 3 + 2] + world[ib * 3 + 2] + world[ic * 3 + 2]) / 3;
  const side = material.side === undefined ? FRONT : material.side;
  const front =
    faceNormal.x * (cameraPos.x - cx) +
      faceNormal.y * (cameraPos.y - cy) +
      faceNormal.z * (cameraPos.z - cz) >
    0;
  if (side === FRONT && !front) return null;
  if (side === BACK && front) return null;
  if (!front) faceNormal.multiplyScalar(-1);

  const vertexColor = [];
  if (colorAttribute) {
    for (const index of [ia, ib, ic]) {
      vertexColor.push(
        colorAttribute.getX(index),
        colorAttribute.getY(index),
        colorAttribute.getZ(index),
      );
    }
  }

  const transparent = material.transparent === true || material.opacity < 1;

  return {
    x: [x0, x1, x2],
    y: [y0, y1, y2],
    z: [z0, z1, z2],
    invW: [1 / w0, 1 / w1, 1 / w2],
    world: [
      world[ia * 3], world[ia * 3 + 1], world[ia * 3 + 2],
      world[ib * 3], world[ib * 3 + 1], world[ib * 3 + 2],
      world[ic * 3], world[ic * 3 + 1], world[ic * 3 + 2],
    ],
    normals: [
      normals[ia * 3], normals[ia * 3 + 1], normals[ia * 3 + 2],
      normals[ib * 3], normals[ib * 3 + 1], normals[ib * 3 + 2],
      normals[ic * 3], normals[ic * 3 + 1], normals[ic * 3 + 2],
    ],
    faceNormal,
    vertexColor: vertexColor.length ? vertexColor : null,
    material,
    lights,
    cameraPos,
    transparent,
    sortZ: (z0 + z1 + z2) / 3,
    wireframe: material.wireframe === true,
  };
}

// material.clippingPlanes (world space), as three.js does: a fragment is cut when it is behind any plane,
// or behind every plane with clipIntersection.
function clippedOut(material, x, y, z) {
  const planes = material.clippingPlanes;
  if (!planes || !planes.length) return false;
  const behind = (plane) => plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant < 0;
  return material.clipIntersection ? planes.every(behind) : planes.some(behind);
}

function edge(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function drawTriangle(triangle, color, alpha, depth, width, height, blend) {
  if (triangle.wireframe) {
    const segments = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];
    for (const [a, b] of segments) {
      drawLine(
        {
          ax: triangle.x[a],
          ay: triangle.y[a],
          az: triangle.z[a],
          bx: triangle.x[b],
          by: triangle.y[b],
          bz: triangle.z[b],
          color: readColor(triangle.material.color) || [1, 1, 1],
        },
        color,
        alpha,
        depth,
        width,
        height,
      );
    }
    return;
  }

  const [x0, x1, x2] = [triangle.x[0] * width, triangle.x[1] * width, triangle.x[2] * width];
  const [y0, y1, y2] = [
    triangle.y[0] * height,
    triangle.y[1] * height,
    triangle.y[2] * height,
  ];
  const [z0, z1, z2] = triangle.z;
  const area = edge(x0, y0, x1, y1, x2, y2);
  if (Math.abs(area) < 1e-12) return;

  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));

  const [iw0, iw1, iw2] = triangle.invW;
  const material = triangle.material;
  const opacity = material.opacity === undefined ? 1 : material.opacity;

  for (let py = minY; py <= maxY; py++) {
    const fy = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      const fx = px + 0.5;
      const e0 = edge(x1, y1, x2, y2, fx, fy);
      const e1 = edge(x2, y2, x0, y0, fx, fy);
      const e2 = edge(x0, y0, x1, y1, fx, fy);
      const b0 = e0 / area;
      const b1 = e1 / area;
      const b2 = e2 / area;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;

      const z = b0 * z0 + b1 * z1 + b2 * z2;
      const index = py * width + px;
      if (blend) {
        if (z > depth[index]) continue;
      } else if (z >= depth[index]) {
        continue;
      }

      const perspective = b0 * iw0 + b1 * iw1 + b2 * iw2;
      const p0 = (b0 * iw0) / perspective;
      const p1 = (b1 * iw1) / perspective;
      const p2 = (b2 * iw2) / perspective;

      const wx = p0 * triangle.world[0] + p1 * triangle.world[3] + p2 * triangle.world[6];
      const wy = p0 * triangle.world[1] + p1 * triangle.world[4] + p2 * triangle.world[7];
      const wz = p0 * triangle.world[2] + p1 * triangle.world[5] + p2 * triangle.world[8];
      if (clippedOut(material, wx, wy, wz)) continue;

      let nx = triangle.faceNormal.x;
      let ny = triangle.faceNormal.y;
      let nz = triangle.faceNormal.z;
      if (!material.flatShading) {
        nx = p0 * triangle.normals[0] + p1 * triangle.normals[3] + p2 * triangle.normals[6];
        ny = p0 * triangle.normals[1] + p1 * triangle.normals[4] + p2 * triangle.normals[7];
        nz = p0 * triangle.normals[2] + p1 * triangle.normals[5] + p2 * triangle.normals[8];
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
      }

      let base = readColor(material.color) || [1, 1, 1];
      if (triangle.vertexColor) {
        base = [
          base[0] * (p0 * triangle.vertexColor[0] + p1 * triangle.vertexColor[3] + p2 * triangle.vertexColor[6]),
          base[1] * (p0 * triangle.vertexColor[1] + p1 * triangle.vertexColor[4] + p2 * triangle.vertexColor[7]),
          base[2] * (p0 * triangle.vertexColor[2] + p1 * triangle.vertexColor[5] + p2 * triangle.vertexColor[8]),
        ];
      }

      const shaded = shade(
        material,
        triangle.lights,
        wx,
        wy,
        wz,
        nx,
        ny,
        nz,
        base,
        triangle.cameraPos,
      );

      if (blend && material.blending === THREE.AdditiveBlending) {
        // additive (particles, glows): light adds up where it overlaps
        const a = Math.min(1, Math.max(0, opacity * shaded[3]));
        color[index * 3] += shaded[0] * a;
        color[index * 3 + 1] += shaded[1] * a;
        color[index * 3 + 2] += shaded[2] * a;
        alpha[index] = Math.min(1, alpha[index] + a * a);
      } else if (blend) {
        const a = Math.min(1, Math.max(0, opacity * shaded[3]));
        color[index * 3] = shaded[0] * a + color[index * 3] * (1 - a);
        color[index * 3 + 1] = shaded[1] * a + color[index * 3 + 1] * (1 - a);
        color[index * 3 + 2] = shaded[2] * a + color[index * 3 + 2] * (1 - a);
        alpha[index] = a + alpha[index] * (1 - a);
      } else {
        color[index * 3] = shaded[0];
        color[index * 3 + 1] = shaded[1];
        color[index * 3 + 2] = shaded[2];
        alpha[index] = Math.min(1, Math.max(0, opacity));
        depth[index] = z;
      }
    }
  }
}

function shade(material, lights, wx, wy, wz, nx, ny, nz, base, cameraPos) {
  if (material.isMeshNormalMaterial) {
    return [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1];
  }
  if (material.isMeshBasicMaterial) {
    return [base[0], base[1], base[2], 1];
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;

  const roughness = material.roughness === undefined ? 0.5 : material.roughness;
  const metalness = material.metalness === undefined ? 0 : material.metalness;
  const shininess = material.isMeshPhongMaterial
    ? material.shininess || 30
    : Math.max(2, 2 / Math.max(roughness * roughness, 1e-4) - 2);
  const specular = readColor(material.specular) || [0.04, 0.04, 0.04];
  const specStrength = material.isMeshStandardMaterial
    ? 0.04 + metalness * 0.96
    : 1;

  const viewX = cameraPos.x - wx;
  const viewY = cameraPos.y - wy;
  const viewZ = cameraPos.z - wz;
  const viewLength = Math.hypot(viewX, viewY, viewZ) || 1;
  const vx = viewX / viewLength;
  const vy = viewY / viewLength;
  const vz = viewZ / viewLength;

  for (const light of lights) {
    if (light.type === "ambient") {
      r += light.color.r * light.intensity;
      g += light.color.g * light.intensity;
      b += light.color.b * light.intensity;
      continue;
    }
    if (light.type === "hemisphere") {
      const mix = ny * 0.5 + 0.5;
      r += (light.ground.r + (light.sky.r - light.ground.r) * mix) * light.intensity;
      g += (light.ground.g + (light.sky.g - light.ground.g) * mix) * light.intensity;
      b += (light.ground.b + (light.sky.b - light.ground.b) * mix) * light.intensity;
      continue;
    }

    let lx;
    let ly;
    let lz;
    let attenuation = 1;

    if (light.type === "directional") {
      lx = -light.direction.x;
      ly = -light.direction.y;
      lz = -light.direction.z;
    } else if (light.type === "point" || light.type === "spot") {
      const dx = light.position.x - wx;
      const dy = light.position.y - wy;
      const dz = light.position.z - wz;
      const distance = Math.hypot(dx, dy, dz) || 1;
      lx = dx / distance;
      ly = dy / distance;
      lz = dz / distance;
      attenuation = 1 / Math.pow(Math.max(distance, 1e-4), light.decay);
      if (light.distance > 0) {
        attenuation *= Math.max(0, 1 - Math.pow(distance / light.distance, 4));
      }
      if (light.type === "spot") {
        const cone = -(lx * light.direction.x + ly * light.direction.y + lz * light.direction.z);
        const cosOuter = Math.cos(light.angle);
        const cosInner = Math.cos(light.angle * (1 - light.penumbra));
        const factor = Math.min(1, Math.max(0, (cone - cosOuter) / Math.max(cosInner - cosOuter, 1e-4)));
        attenuation *= factor * factor;
      }
    } else {
      continue;
    }

    const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
    if (ndl <= 0) continue;

    const strength = light.intensity * attenuation * ndl;
    r += light.color.r * strength;
    g += light.color.g * strength;
    b += light.color.b * strength;

    if (material.isMeshPhongMaterial || material.isMeshStandardMaterial) {
      let hx = lx + vx;
      let hy = ly + vy;
      let hz = lz + vz;
      const halfLength = Math.hypot(hx, hy, hz) || 1;
      hx /= halfLength;
      hy /= halfLength;
      hz /= halfLength;
      const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), shininess);
      const k = spec * light.intensity * attenuation * specStrength;
      sr += light.color.r * specular[0] * k;
      sg += light.color.g * specular[1] * k;
      sb += light.color.b * specular[2] * k;
    }
  }

  const emissive = readColor(material.emissive) || [0, 0, 0];
  return [
    base[0] * r + emissive[0] + sr,
    base[1] * g + emissive[1] + sg,
    base[2] * b + emissive[2] + sb,
    1,
  ];
}

function collectLine(object, vp, out) {
  const geometry = object.geometry;
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
  const position = geometry.attributes.position;
  const colorAttribute = geometry.attributes.color;
  const index = geometry.index ? geometry.index.array : null;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  const color = readColor(material && material.color) || [1, 1, 1];
  const count = index ? index.length : position.count;

  const world = new Float32Array(position.count * 3);
  const clip = new Float32Array(position.count * 4);
  const model = object.matrixWorld;
  const vector = new THREE.Vector3();
  const vector4 = new THREE.Vector4();
  for (let i = 0; i < position.count; i++) {
    vector.fromBufferAttribute(position, i).applyMatrix4(model);
    world[i * 3] = vector.x;
    world[i * 3 + 1] = vector.y;
    world[i * 3 + 2] = vector.z;
    vector4.set(vector.x, vector.y, vector.z, 1).applyMatrix4(vp);
    clip[i * 4] = vector4.x;
    clip[i * 4 + 1] = vector4.y;
    clip[i * 4 + 2] = vector4.z;
    clip[i * 4 + 3] = vector4.w;
  }

  if (object.isLineSegments) {
    const limit = index ? index.length : position.count;
    for (let i = 0; i + 1 < limit; i += 2) {
      pushLine(out, clip, index ? index[i] : i, index ? index[i + 1] : i + 1, color, colorAttribute);
    }
  } else {
    const limit = index ? index.length : position.count;
    for (let i = 0; i + 1 < limit; i++) {
      pushLine(out, clip, index ? index[i] : i, index ? index[i + 1] : i + 1, color, colorAttribute);
    }
    if (object.isLineLoop && limit > 1) {
      pushLine(out, clip, index ? index[limit - 1] : limit - 1, index ? index[0] : 0, color, colorAttribute);
    }
  }
}

function pushLine(out, clip, a, b, color, colorAttribute) {
  const wa = clip[a * 4 + 3];
  const wb = clip[b * 4 + 3];
  if (wa <= 1e-5 || wb <= 1e-5) return;
  out.push({
    ax: (clip[a * 4] / wa) * 0.5 + 0.5,
    ay: 0.5 - (clip[a * 4 + 1] / wa) * 0.5,
    az: clip[a * 4 + 2] / wa,
    bx: (clip[b * 4] / wb) * 0.5 + 0.5,
    by: 0.5 - (clip[b * 4 + 1] / wb) * 0.5,
    bz: clip[b * 4 + 2] / wb,
    color,
    colorA: colorAttribute
      ? [colorAttribute.getX(a), colorAttribute.getY(a), colorAttribute.getZ(a)]
      : null,
    colorB: colorAttribute
      ? [colorAttribute.getX(b), colorAttribute.getY(b), colorAttribute.getZ(b)]
      : null,
  });
}

function collectPoints(object, vp, out) {
  const geometry = object.geometry;
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return;
  const position = geometry.attributes.position;
  const colorAttribute = geometry.attributes.color;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  const color = readColor(material && material.color) || [1, 1, 1];
  const size = Math.max(1, material && material.size ? Math.min(4, material.size) : 2);
  const model = object.matrixWorld;
  const vector = new THREE.Vector3();
  const vector4 = new THREE.Vector4();
  for (let i = 0; i < position.count; i++) {
    vector.fromBufferAttribute(position, i).applyMatrix4(model);
    vector4.set(vector.x, vector.y, vector.z, 1).applyMatrix4(vp);
    const w = vector4.w;
    if (w <= 1e-5) continue;
    out.push({
      x: (vector4.x / w) * 0.5 + 0.5,
      y: 0.5 - (vector4.y / w) * 0.5,
      z: vector4.z / w,
      size,
      color: colorAttribute
        ? [colorAttribute.getX(i), colorAttribute.getY(i), colorAttribute.getZ(i)]
        : color,
    });
  }
}

function drawPoint(point, color, alpha, depth, width, height) {
  const px = Math.round(point.x * width);
  const py = Math.round(point.y * height);
  const half = Math.floor(point.size / 2);
  for (let y = py - half; y <= py + half; y++) {
    if (y < 0 || y >= height) continue;
    for (let x = px - half; x <= px + half; x++) {
      if (x < 0 || x >= width) continue;
      const index = y * width + x;
      if (point.z >= depth[index]) continue;
      depth[index] = point.z;
      color[index * 3] = point.color[0];
      color[index * 3 + 1] = point.color[1];
      color[index * 3 + 2] = point.color[2];
      alpha[index] = 1;
    }
  }
}

function drawLine(line, color, alpha, depth, width, height) {
  let x0 = line.ax * width;
  let y0 = line.ay * height;
  let x1 = line.bx * width;
  let y1 = line.by * height;
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return;
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(x0 + dx * t);
    const py = Math.round(y0 + dy * t);
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const z = line.az + (line.bz - line.az) * t;
    const index = py * width + px;
    if (z >= depth[index]) continue;
    depth[index] = z;
    let r = line.color[0];
    let g = line.color[1];
    let b = line.color[2];
    if (line.colorA && line.colorB) {
      r = line.colorA[0] + (line.colorB[0] - line.colorA[0]) * t;
      g = line.colorA[1] + (line.colorB[1] - line.colorA[1]) * t;
      b = line.colorA[2] + (line.colorB[2] - line.colorA[2]) * t;
    }
    color[index * 3] = r;
    color[index * 3 + 1] = g;
    color[index * 3 + 2] = b;
    alpha[index] = 1;
  }
}

globalThis.__liosvideoCli = { prepareThreeScene, renderThreeScene };
