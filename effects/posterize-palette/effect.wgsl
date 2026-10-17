// Posterisierung: jedes Pixel wird auf die nächste Palettenfarbe gesetzt (Abstand in Oklab oder RGB).

fn nearest(c: vec3f) -> vec3f {
  let n = min(params.palette_count, 16u);
  let use_lab = params.metric == 0u;
  let q = select(c, oklab_from_linear(c), use_lab);
  var best = params.palette[0].rgb;
  var bd = 1e30;
  for (var i = 0u; i < n; i++) {
    let pc = params.palette[i].rgb;
    let d = distance(q, select(pc, oklab_from_linear(pc), use_lab));
    if (d < bd) {
      bd = d;
      best = pc;
    }
  }
  return best;
}

@compute @workgroup_size(8, 8)
fn quantize(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  if (c.a <= 0.0) {
    textureStore(dst, id.xy, vec4f(0.0));
    return;
  }
  textureStore(dst, id.xy, premultiply(vec4f(nearest(c.rgb), c.a)));
}
