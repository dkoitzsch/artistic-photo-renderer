// Infrarot. Näherung der Infrarot-Reflexion aus RGB: Pflanzen (grün-gelb, gesättigt) reflektieren stark, Himmel und
// Wasser (blau) kaum, sonst ungefähr die Helligkeit. Farbinfrarot verschiebt die Kanäle wie Farbinfrarotfilm:
// IR → Rot, Rot → Grün, Grün → Blau. Schwarz-Weiß: Grauwert = IR. Leuchten = helle Bereiche weichgezeichnet addiert.

fn ir_of(s: vec3f) -> f32 {
  let mx = max(s.r, max(s.g, s.b));
  let mn = min(s.r, min(s.g, s.b));
  let sat = select(0.0, (mx - mn) / mx, mx > 1e-4);
  // grün-gelber Anteil (Laub): Grün dominiert über Blau
  let leafy = clamp((s.g - s.b) * 2.5, 0.0, 1.0) * clamp(1.0 - (s.r - s.g) * 3.0, 0.0, 1.0) * sat;
  let blue = clamp((s.b - max(s.r, s.g)) * 3.0, 0.0, 1.0);
  let base = dot(s, vec3f(0.45, 0.4, 0.15));
  return clamp(base + leafy * params.foliage / 100.0 * 0.9 - blue * 0.45, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn convert(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(textureLoad(src, vec2i(id.xy), 0));
  let s = clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0));
  let ir = ir_of(s);
  var out: vec3f;
  if (params.mode == 0u) {
    out = vec3f(ir, s.r, s.g * 0.9 + s.b * 0.1);
  } else {
    out = vec3f(ir);
  }
  out = mix(s, out, params.strength / 100.0);
  textureStore(dst, id.xy, premultiply(vec4f(srgb_to_linear(out), c.a)));
}

@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let c = textureLoad(src, p, 0);
  let b = unpremultiply(textureLoad(src_b, p, 0)).rgb;
  let g = params.glow / 100.0;
  // nur helle Anteile leuchten
  let bright = max(b - vec3f(0.35), vec3f(0.0)) * 1.6;
  var rgb = unpremultiply(c).rgb;
  rgb = rgb + bright * g * select(1.0, 0.0, params.glow <= 0.0);
  // Leuchten hebt die Schatten leicht an und senkt Kontrast (Diffusion im Film)
  rgb = mix(rgb, max(rgb, b), g * 0.35);
  textureStore(dst, id.xy, premultiply(vec4f(rgb, c.a)));
}
