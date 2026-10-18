// Alte Verfahren. Cyanotypie: Tonwert → Preußischblau auf Papier, Lichter bleiben papierfarben. Sepia: Tonung warmer
// Brauntöne. Kollodium: nur blauempfindlich (Rot wird dunkel, Blau hell), harter Kontrast, silbrig-olive Töne, dunkle
// Gießränder. Randartefakte entstehen aus Rauschen über den Abstand zum Leinwandrand (kachelgenau, mit Seed).

fn edge_mask(cp: vec2f, canvas: vec2f) -> f32 {
  // Abstand zum nächsten Rand relativ zur kurzen Kante, mit verrauschter Grenze (Pinsel/Gießrand)
  let d = min(min(cp.x, canvas.x - cp.x), min(cp.y, canvas.y - cp.y)) / min(canvas.x, canvas.y);
  let s = min(canvas.x, canvas.y);
  let n = rand_fbm(cp, s * 0.03, 4u, params.seed) - 0.5;
  let streak = rand_noise(vec2f(cp.x * 0.02, cp.y * 0.6), s * 0.01, params.seed + 5u) - 0.5;
  let border = 0.035 + 0.05 * n + 0.02 * streak;
  return smoothstep(border - 0.01, border + 0.015, d);
}

fn effect(p: vec2i) -> vec4f {
  let canvas = params.canvas_size / params.scale;
  let cp = canvas_pos(p);
  let src = unpremultiply(load_src(p));
  let s = clamp(linear_to_srgb(src.rgb), vec3f(0.0), vec3f(1.0));
  var l = 0.0;
  if (params.process == 2u) {
    // blauempfindlich (orthochromatisch fehlt sogar): Rot sehr dunkel
    l = clamp(dot(s, vec3f(0.05, 0.25, 0.7)) * 1.15, 0.0, 1.0);
  } else {
    l = luminance(s);
  }
  let k = params.contrast / 100.0;
  l = clamp((l - 0.5) * (1.0 + k * 1.5) + 0.5, 0.0, 1.0);
  let paper = linear_to_srgb(params.paper);
  var out = vec3f(l);
  switch params.process {
    case 0u: {
      // Preußischblau: Schatten tiefblau, Lichter Papier
      let blue = vec3f(0.03, 0.17, 0.4);
      let mid = vec3f(0.18, 0.42, 0.66);
      out = mix(mix(blue, mid, smoothstep(0.0, 0.55, l)), paper, smoothstep(0.45, 1.0, l));
    }
    case 1u: {
      let shadow = vec3f(0.2, 0.12, 0.07);
      let mid = vec3f(0.64, 0.47, 0.32);
      out = mix(mix(shadow, mid, smoothstep(0.0, 0.6, l)), paper, smoothstep(0.55, 1.0, l));
    }
    default: {
      let shadow = vec3f(0.06, 0.06, 0.05);
      let mid = vec3f(0.55, 0.53, 0.46);
      let hi = vec3f(0.86, 0.86, 0.8);
      out = mix(mix(shadow, mid, smoothstep(0.0, 0.55, l)), hi, smoothstep(0.5, 1.0, l));
    }
  }
  out = mix(vec3f(luminance(s)), out, params.strength / 100.0);
  // Flecken und Unruhe in der Fläche
  let e = params.edges / 100.0;
  let spots = smoothstep(0.82, 0.9, rand_fbm(cp, min(canvas.x, canvas.y) * 0.02, 3u, params.seed + 9u));
  // Ränder: Cyanotypie/Sepia zeigen Papier, Kollodium dunkle Gießränder
  let m = mix(1.0, edge_mask(cp, canvas), e);
  if (params.process == 2u) {
    out = mix(vec3f(0.04, 0.035, 0.03), out, m);
    out = mix(out, out * 0.6, spots * e);
  } else {
    out = mix(paper, out, m);
    out = mix(out, mix(out, paper, 0.6), spots * e * 0.6);
  }
  // Vignette
  let u = (cp / canvas - 0.5) * 2.0;
  out *= 1.0 - params.vignette / 100.0 * 0.6 * smoothstep(0.4, 1.5, length(u));
  return premultiply(vec4f(srgb_to_linear(clamp(out, vec3f(0.0), vec3f(1.0))), src.a));
}
