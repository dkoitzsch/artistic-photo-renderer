// Tilt-Shift: drei Unschärfestufen (⅓, ⅔, 1 · blur) werden je Pixel nach dem Abstand zum Schärfeband stückweise linear
// gemischt (level: v0.x = Stufe k, mischt src → src_b mit clamp(3t − k)); danach Sättigung anheben.

/** 0 im Schärfeband … 1 außerhalb des Übergangs; Abstand relativ zur Leinwandhöhe (gleich in Vorschau/Export). */
fn band_t(p: vec2i) -> f32 {
  let cs = params.canvas_size;
  let c = vec2f(cs.x * 0.5, cs.y * params.position / 100.0);
  let n = vec2f(-sin(params.angle), cos(params.angle));
  let d = abs(dot(vec2f(p) + 0.5 + params.origin - c, n)) / max(cs.y, 1.0);
  let half = params.width / 200.0;
  return smoothstep(half, half + params.transition / 100.0, d);
}

@compute @workgroup_size(8, 8)
fn level(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let w = clamp(3.0 * band_t(p) - pass_data.v0.x, 0.0, 1.0);
  textureStore(dst, id.xy, mix(load_src(p), textureLoad(src_b, p, 0), w));
}

@compute @workgroup_size(8, 8)
fn saturate(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  let s = linear_to_srgb(clamp(c.rgb, vec3f(0.0), vec3f(1.0)));
  let l = luminance(s);
  let boosted = clamp(mix(vec3f(l), s, 1.0 + params.saturation / 100.0), vec3f(0.0), vec3f(1.0));
  textureStore(dst, id.xy, premultiply(vec4f(srgb_to_linear(boosted), c.a)));
}
