// One layer filter pass. Prepended with common.wgsl. Layers hold premultiplied colour.
// mode: 1 pixelate, 2 posterize, 3 halftone, 4 outline, 5 chalk, 6 glow (src + extra × intensity)
struct FilterU {
  mode: f32,
  amount: f32,    // device px for pixelate / halftone / outline, levels for posterize, strength for chalk
  scale: f32,     // device px per composition px
  intensity: f32, // glow strength
  color: vec4f,   // premultiplied outline colour
};

@group(0) @binding(0) var<uniform> u: FilterU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var extra: texture_2d<f32>;

fn load(p: vec2i) -> vec4f {
  return textureLoad(src, clamp(p, vec2i(0), vec2i(textureDimensions(src)) - 1), 0);
}

fn unpremultiply(c: vec4f) -> vec3f {
  return select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
}

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

// Integer hash (PCG), so every GPU backend produces the same grain.
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn hash(p: vec2f) -> f32 {
  return f32(pcg(u32(p.x) ^ pcg(u32(p.y)))) / 4294967295.0;
}

fn pixelate(pos: vec2f) -> vec4f {
  let cell = max(u.amount, 1.0);
  let center = (floor(pos / cell) + 0.5) * cell;
  return load(vec2i(center));
}

fn posterize(pos: vec2f) -> vec4f {
  let c = load(vec2i(pos));
  if (c.a <= 0.0) { return vec4f(0.0); }
  let levels = max(u.amount, 2.0) - 1.0;
  let q = floor(unpremultiply(c) * levels + 0.5) / levels;
  return vec4f(q * c.a, c.a);
}

fn halftone(pos: vec2f) -> vec4f {
  let c = load(vec2i(pos));
  if (c.a <= 0.0) { return vec4f(0.0); }
  let cell = max(u.amount, 2.0);
  let center = (floor(pos / cell) + 0.5) * cell;
  // a centre outside the shape has no tone of its own: use this pixel's instead (no dark fringe)
  let cc = load(vec2i(center));
  let tone = select(c, cc, cc.a > 0.0);
  let darkness = 1.0 - luma(unpremultiply(tone));
  let radius = cell * 0.55 * clamp(darkness, 0.0, 1.0);
  let inside = clamp(radius - distance(pos, center) + 0.5, 0.0, 1.0);
  return vec4f(c.rgb * mix(1.0, 0.45, inside), c.a);
}

fn outline(pos: vec2f) -> vec4f {
  let c = load(vec2i(pos));
  let p = vec2i(pos);
  // ink outside the shape: the most opaque neighbour within the line width
  let w = min(u.amount, 12.0);
  let r = i32(ceil(w));
  var near = 0.0;
  for (var y = -r; y <= r; y++) {
    for (var x = -r; x <= r; x++) {
      if (f32(x * x + y * y) <= w * w) { near = max(near, load(p + vec2i(x, y)).a); }
    }
  }
  // ink inside the shape: sharp luminance changes (Sobel)
  var gx = 0.0;
  var gy = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let l = luma(load(p + vec2i(x, y)).rgb);
      let k = select(1.0, 2.0, x == 0 || y == 0);
      gx += f32(x) * k * l;
      gy += f32(y) * k * l;
    }
  }
  let edge = smoothstep(0.25, 0.6, length(vec2f(gx, gy)));
  let inner = mix(c, u.color * c.a, edge);
  return inner + u.color * near * (1.0 - c.a);
}

fn chalk(pos: vec2f) -> vec4f {
  let c = load(vec2i(pos));
  let q = floor(pos / max(u.scale, 1e-4));
  let grain = hash(q);
  let streak = hash(vec2f(floor(q.y / 2.0), floor((q.x + q.y * 0.3) / 9.0)) + 7919.0);
  let v = 0.55 * grain + 0.45 * streak;
  var keep = clamp(1.0 - u.amount * 0.9 * (1.0 - v), 0.0, 1.0);
  if (grain < u.amount * 0.25) { keep = 0.0; }
  return c * keep;
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let m = i32(u.mode + 0.5);
  switch m {
    case 1: { return pixelate(pos.xy); }
    case 2: { return posterize(pos.xy); }
    case 3: { return halftone(pos.xy); }
    case 4: { return outline(pos.xy); }
    case 5: { return chalk(pos.xy); }
    case 6: {
      let glow = textureLoad(extra, vec2i(pos.xy), 0) * u.intensity;
      return min(load(vec2i(pos.xy)) + glow, vec4f(1.0));
    }
    default: { return load(vec2i(pos.xy)); }
  }
}
