// Comic: luma → Gauß (σ, 1,6σ) → DoG-Konturen; cel: Helligkeit in Oklab auf Stufen, Farbe angehoben,
// Ben-Day-Punkte in den dunklen Stufen, Konturen darüber.

@compute @workgroup_size(8, 8)
fn luma(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  textureStore(dst, id.xy, vec4f(mix(1.0, linear_to_srgb(vec3f(luminance(c.rgb))).x, c.a)));
}

// src = G1, src_b = G2 → Konturstärke 0..1 (r)
@compute @workgroup_size(8, 8)
fn edges_dog(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let d = load_src(p).r - textureLoad(src_b, p, 0).r; // < 0 an dunklen Kanten
  let t = 0.002 + 0.03 * (1.0 - params.outlineThreshold / 100.0);
  textureStore(dst, id.xy, vec4f(smoothstep(t, t * 2.5, -d)));
}

@compute @workgroup_size(8, 8)
fn cel(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let c = unpremultiply(load_src(p));
  if (c.a <= 0.0) {
    textureStore(dst, id.xy, vec4f(0.0));
    return;
  }
  var lab = oklab_from_linear(max(c.rgb, vec3f(0.0)));
  // Stufen mit schmalem weichen Übergang (Kantenglättung)
  let n = f32(max(params.levels, 2));
  let x = lab.x * n;
  let fl = floor(x);
  let step = (fl + smoothstep(0.45, 0.55, x - fl)) / n;
  let level = clamp(step + 0.5 / n, 0.0, 1.0);
  lab = vec3f(level, lab.yz * (1.0 + params.saturation / 100.0 * 1.5));
  var rgb = clamp(linear_from_oklab(lab), vec3f(0.0), vec3f(1.0));
  // Ben-Day-Punkte: gedrehtes Raster in Leinwand-px, Punktgröße wächst mit der Dunkelheit
  if (params.dots > 0.0) {
    let cp = canvas_pos(p);
    let cs = vec2f(cos(params.dotAngle), sin(params.dotAngle));
    let r = vec2f(cs.x * cp.x + cs.y * cp.y, -cs.y * cp.x + cs.x * cp.y) / max(params.dotSize / params.scale, 1.0);
    let f = fract(r) - 0.5;
    let dark = 1.0 - level;
    let radius = sqrt(clamp(dark * 1.2 - 0.1, 0.0, 1.0)) * 0.55;
    let px = params.scale / max(params.dotSize, 1e-3);
    let dot = 1.0 - smoothstep(radius - px, radius + px, length(f));
    rgb = rgb * mix(1.0, 0.35, dot * params.dots / 100.0);
  }
  // Konturen
  let e = textureLoad(src_b, p, 0).r;
  rgb = mix(rgb, params.lineColor, e * step_outline());
  textureStore(dst, id.xy, premultiply(vec4f(rgb, c.a)));
}

fn step_outline() -> f32 {
  return select(0.0, 1.0, params.outline > 0.0);
}
