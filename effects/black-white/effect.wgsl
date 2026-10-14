// Schwarz-Weiß: Kanalmischer im linearen Raum, Tonwerte (Schwarz-/Weißpunkt, Helligkeit, S-Kurve)
// wahrnehmungsnah auf sRGB-kodierten Werten, Korn ortsfest auf der Leinwand (gleich in Vorschau und Export).

fn s_curve(t: f32, k: f32) -> f32 {
  if (k >= 0.0) {
    let s = t * t * t * (t * (t * 6.0 - 15.0) + 10.0); // smootherstep
    return mix(t, s, k);
  }
  let inv = 0.5 - sin(asin(clamp(1.0 - 2.0 * t, -1.0, 1.0)) / 3.0); // Umkehrung von smoothstep
  return mix(t, inv, -k);
}

fn value_noise(x: vec2f) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  let base = vec2u(vec2i(i) + vec2i(100000));
  let a = hash21(base);
  let b = hash21(base + vec2u(1u, 0u));
  let c = hash21(base + vec2u(0u, 1u));
  let d = hash21(base + vec2u(1u, 1u));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn effect(p: vec2i) -> vec4f {
  let px = unpremultiply(load_src(p));
  let mixer = vec3f(params.red, params.green, params.blue) / 100.0;
  let gray_lin = max(dot(px.rgb, mixer), 0.0);
  var t = linear_to_srgb(vec3f(gray_lin)).r;

  let bp = params.blackPoint / 100.0;
  let wp = params.whitePoint / 100.0;
  t = clamp((t - bp) / max(wp - bp, 1e-4), 0.0, 1.0);
  t = clamp(t + params.brightness / 200.0, 0.0, 1.0);
  t = s_curve(t, params.contrast / 100.0);

  if (params.grain > 0.0) {
    let n = value_noise(canvas_pos(p) / max(params.grainSize, 0.1)) - 0.5;
    // Korn wirkt am stärksten in den Mitteltönen
    t = clamp(t + n * (params.grain / 100.0) * 0.35 * (1.0 - abs(2.0 * t - 1.0) * 0.6), 0.0, 1.0);
  }

  let gray = srgb_to_linear(vec3f(t));
  let rgb = mix(px.rgb, gray, params.amount / 100.0);
  return premultiply(vec4f(rgb, px.a));
}
