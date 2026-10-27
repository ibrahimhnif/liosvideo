// Composites a layer texture with opacity and an optional rounded-rect clip. Prepended with common.wgsl.
struct CompU {
  inv0: vec4f,   // inverse clip affine a b c d (device px → clip local)
  inv1: vec4f,   // inverse e f, clip size w h
  params: vec4f, // opacity, radius, hasClip, local units per device px
};

@group(0) @binding(0) var<uniform> u: CompU;
@group(0) @binding(1) var src: texture_2d<f32>;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var col = textureLoad(src, vec2i(pos.xy), 0) * u.params.x;
  if (u.params.z > 0.5) {
    let p = pos.xy;
    let local = vec2f(u.inv0.x * p.x + u.inv0.z * p.y + u.inv1.x, u.inv0.y * p.x + u.inv0.w * p.y + u.inv1.y);
    let half = u.inv1.zw * 0.5;
    let d = sdRoundBox(local - half, half, min(u.params.y, min(half.x, half.y)));
    col *= clamp(0.5 - d / max(u.params.w, 1e-4), 0.0, 1.0);
  }
  return col;
}
