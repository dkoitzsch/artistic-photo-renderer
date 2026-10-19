// Alterung: alles hängt nur von Leinwand-px und Seed ab (kachelgenau).
// Craquelé: Voronoi-Netz (Abstand zur Zellgrenze F2 − F1); Netzgröße wächst mit der Schichtdicke (helle, pastose
// Stellen), Rissbreite und -tiefe mit den Jahren; dazu ein feineres Sekundärnetz und Schüsselbildung (Zellränder
// heben sich, dunkler). Firnis vergilbt (Bernstein-Ton, Kontrastverlust), lichtempfindliche Rot-/Violetttöne bleichen
// aus, feuchtes Klima bringt Schmutz zu den Rändern und Stockflecken.

/** Abstand zur nächsten Zellgrenze eines Voronoi-Netzes (Zellgröße cell, Leinwand-px) */
fn voronoi_edge(cp: vec2f, cell: f32, seed: u32) -> vec2f {
  let q = cp / cell;
  let base = vec2i(floor(q));
  var d1 = 1e9;
  var d2 = 1e9;
  var id1 = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = base + vec2i(x, y);
      let jitter = vec2f(rand_cell(c, seed, 0u), rand_cell(c, seed, 1u));
      let pt = vec2f(c) + 0.15 + 0.7 * jitter;
      let d = distance(q, pt);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id1 = rand_cell(c, seed, 2u);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  // (d2 − d1)/2 ≈ Abstand zur Grenze in Zellen
  return vec2f((d2 - d1) * 0.5 * cell, id1);
}

fn effect(p: vec2i) -> vec4f {
  let c = load_src(p);
  if (c.a <= 0.0) { return c; }
  var rgb = c.rgb / c.a;
  let cp = canvas_pos(p);
  let age = clamp(params.years / 500.0, 0.0, 1.0);
  let humid = params.climate == 1u;
  // Schichtdicke: helle Stellen dicker
  let thick = mix(0.5, load_luminance(p), params.thickness / 100.0);
  // zwei feste Netze (fein, grob) nach Schichtdicke überblendet – ein Netz mit örtlich wechselnder Größe würde reißen
  let size = params.crackSize / params.scale;
  let crackAge = age * select(1.0, 0.7, humid);
  let fine = voronoi_edge(cp, size * 0.7, params.seed);
  let coarse = voronoi_edge(cp + vec2f(113.0, 71.0), size * 1.4, params.seed + 5u);
  let tk = smoothstep(0.35, 0.65, thick);
  let e1 = select(fine, coarse, tk > 0.5);
  let e2 = voronoi_edge(cp * 1.0 + vec2f(37.0, 11.0), size * 0.45, params.seed + 3u);
  let w = mix(0.3, 1.6, crackAge); // Rissbreite (Leinwand-px)
  // nicht jede Zellgrenze reißt: Stärke entlang des Netzes unregelmäßig, Breite schwankt
  let along = smoothstep(0.3, 0.6, rand_noise(cp, size * 0.6, params.seed + 13u));
  let wv = w * (0.6 + 0.8 * rand_noise(cp, size * 0.3, params.seed + 17u));
  let crack = (1.0 - smoothstep(wv * 0.5, wv, e1.x)) * smoothstep(0.05, 0.25, crackAge) * along;
  let crack2 = (1.0 - smoothstep(w * 0.25, w * 0.6, e2.x)) * smoothstep(0.35, 0.8, crackAge) * 0.6;
  // Schüsselbildung: zum Zellrand hin dunkler, je Zelle leicht anders
  let cup = smoothstep(size * 0.35, 0.0, e1.x) * crackAge * 0.15 * (0.6 + 0.8 * e1.y);
  // Ausbleichen: Rot/Magenta/Violett stärker (lichtempfindliche Lacke), allgemein Sättigungsverlust
  let lab = oklab_from_linear(max(rgb, vec3f(0.0)));
  let hue = atan2(lab.z, lab.y); // Rot ≈ 0.5, Magenta/Violett ≈ −0.5 … −1.2
  let sensitive = smoothstep(0.9, 0.2, abs(hue - 0.2)) + smoothstep(0.9, 0.3, abs(hue + 0.8));
  let fade = age * (0.25 + 0.55 * clamp(sensitive, 0.0, 1.0)) * select(0.8, 1.0, humid);
  var faded = linear_from_oklab(vec3f(lab.x + fade * 0.06, lab.yz * (1.0 - fade)));
  // Firnis: Bernstein, leichter Kontrastverlust
  if (params.varnish != 0u) {
    let amber = srgb_to_linear(vec3f(1.0, 0.82, 0.52));
    let k = smoothstep(0.0, 1.0, age);
    faded = mix(faded, faded * amber * 0.92, k * 0.85);
    faded = mix(faded, vec3f(luminance(faded)) * amber * 0.6, k * 0.15);
  }
  // Schmutz (zu den Rändern hin, feucht stärker) und Stockflecken
  let uv = canvas_pos(p) / max(params.canvas_size / params.scale, vec2f(1.0));
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let grime = smoothstep(0.25, 0.0, edge) * age * select(0.25, 0.5, humid) * (0.6 + 0.8 * rand_fbm(cp, 60.0, 3u, params.seed + 7u));
  var out = faded * (1.0 - grime);
  if (humid) {
    let spot = smoothstep(0.68, 0.8, rand_fbm(cp, 14.0, 3u, params.seed + 11u)) * age * 1.6;
    out = mix(out, out * srgb_to_linear(vec3f(0.62, 0.48, 0.3)), spot * 0.8);
  }
  out *= 1.0 - cup;
  // Risse: dunkle Fugen mit hellem Grat
  let crackCol = out * 0.18;
  out = mix(out, crackCol, max(crack, crack2));
  // heller Grat neben der Fuge (multiplikativ, damit dunkle Stellen keine hellen Linien bekommen)
  out *= 1.0 + 0.12 * smoothstep(wv * 1.6, wv * 1.0, e1.x) * (1.0 - smoothstep(wv * 1.0, wv * 0.6, e1.x)) * along;
  return vec4f(max(out, vec3f(0.0)) * c.a, c.a);
}
