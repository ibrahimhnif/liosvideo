// Prepended with common.wgsl. Draws rects (SDF, antialiased, optional inner stroke), textured quads and solid placeholders.
struct Globals { viewport: vec2f, scale: vec2f };

struct Inst {
  m0: vec4f,      // affine a b c d
  m1: vec4f,      // affine e f, size w h
  color: vec4f,   // fill, straight alpha
  stroke: vec4f,  // stroke, straight alpha
  params: vec4f,  // radius, strokeWidth, opacity, mode (0 rect, 1 texture, 2 solid)
  uv: vec4f,      // u0 v0 u1 v1
};

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) idx: u32,
};

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let inst = insts[ii];
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let c = corners[vi];
  let size = inst.m1.zw;
  // rects grow by ~1 device pixel so the antialiased edge isn't cut off
  let unit = 1.0 / max(length(inst.m0.xy) * g.scale.x, 1e-4);
  let pad = select(0.0, unit, inst.params.w == 0.0);
  let local = c * (size + 2.0 * pad) - pad;
  let world = vec2f(
    inst.m0.x * local.x + inst.m0.z * local.y + inst.m1.x,
    inst.m0.y * local.x + inst.m0.w * local.y + inst.m1.y,
  );
  let px = world * g.scale;
  var o: VOut;
  o.pos = vec4f(px.x / g.viewport.x * 2.0 - 1.0, 1.0 - px.y / g.viewport.y * 2.0, 0.0, 1.0);
  o.local = local;
  o.uv = mix(inst.uv.xy, inst.uv.zw, c);
  o.idx = ii;
  return o;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let inst = insts[in.idx];
  let opacity = inst.params.z;
  let mode = inst.params.w;
  let half = inst.m1.zw * 0.5;
  let r = min(inst.params.x, min(half.x, half.y));
  let d = sdRoundBox(in.local - half, half, r);
  let aa = max(fwidth(d), 1e-4);
  let sampled = textureSampleLevel(tex, samp, in.uv, 0.0);

  if (mode == 1.0) {
    return sampled * opacity;
  }
  if (mode == 2.0) {
    return vec4f(inst.color.rgb * inst.color.a, inst.color.a) * opacity;
  }
  let cov = clamp(0.5 - d / aa, 0.0, 1.0);
  let sw = inst.params.y;
  if (sw > 0.0) {
    let inner = clamp(0.5 - (d + sw) / aa, 0.0, 1.0);
    let fillA = inst.color.a * inner;
    let strokeA = inst.stroke.a * (cov - inner);
    return vec4f(inst.color.rgb * fillA + inst.stroke.rgb * strokeA, fillA + strokeA) * opacity;
  }
  let a = inst.color.a * cov * opacity;
  return vec4f(inst.color.rgb * a, a);
}
