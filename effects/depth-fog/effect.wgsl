// Nebel nach Tiefe (Spec „Effekte“ 5.7): Anteil = 1 − exp(−k · (Tiefe − Beginn)), verstärkt unten im Bild (Bodennebel)
// und moduliert durch weiches Rauschen (Schwaden, ortsfest auf der Leinwand). Ohne Tiefenkarte (Tiefe 0) kein Nebel.

fn effect(p: vec2i) -> vec4f {
  let c = load_src(p);
  let d = load_depth(p);
  let start = params.start / 100.0;
  let t = max(0.0, d - start) / max(1.0 - start, 1e-3);
  let k = params.density / 100.0 * 4.0;
  var f = 1.0 - exp(-k * t);
  // Bodennebel: unten im Bild dichter
  let yb = canvas_pos(p).y / max(params.canvas_size.y / params.scale, 1.0);
  f = f + (1.0 - f) * params.ground / 100.0 * smoothstep(0.35, 1.0, yb) * (0.4 + 0.6 * t);
  // Schwaden
  let n = rand_fbm(canvas_pos(p), params.wispSize / params.scale, 4u, params.seed);
  f = clamp(f * (1.0 + (n - 0.5) * 2.0 * params.wisps / 100.0), 0.0, 1.0);
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  // Lichthof: helle Bereiche schimmern durch
  let glow = params.glow / 100.0 * smoothstep(0.5, 1.0, luminance(rgb)) * f;
  let fogged = mix(rgb, params.color, f) + params.color * glow * 0.4;
  return vec4f(fogged * c.a, c.a);
}
