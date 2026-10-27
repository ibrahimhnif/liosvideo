fn sdRoundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

struct FullscreenOut { @builtin(position) pos: vec4f };

@vertex fn vsFullscreen(@builtin(vertex_index) vi: u32) -> FullscreenOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: FullscreenOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}
