// Bloom: bright (weicher Schwellwert auf der wahrgenommenen Helligkeit) → drei Unschärfen → add2 (gewichtet summieren)
// → combine (Leuchten getönt addieren).

@compute @workgroup_size(8, 8)
fn bright(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = load_src(vec2i(id.xy));
  let u = unpremultiply(c);
  let l = linear_to_srgb(vec3f(luminance(u.rgb))).x;
  let t = params.threshold / 100.0;
  let k = max(params.knee / 100.0 * 0.5, 1e-3);
  let w = smoothstep(t - k, t + k, l);
  textureStore(dst, id.xy, c * w);
}

// dst = src · v0.x + src_b · v0.y
@compute @workgroup_size(8, 8)
fn add2(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  textureStore(dst, id.xy, load_src(p) * pass_data.v0.x + textureLoad(src_b, p, 0) * pass_data.v0.y);
}

@compute @workgroup_size(8, 8)
fn combine(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let c = load_src(p);
  let g = textureLoad(src_b, p, 0).rgb * params.tint * (params.intensity / 100.0);
  let rgb = c.rgb + g;
  // Leuchten darf auch in transparente Bereiche reichen: Deckung mindestens so groß wie das Leuchten
  let a = max(c.a, clamp(max(max(g.r, g.g), g.b), 0.0, 1.0));
  textureStore(dst, id.xy, vec4f(rgb, a));
}
