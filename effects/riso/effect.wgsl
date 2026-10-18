// Risografie: subtraktives Modell – jede Farbe nimmt Licht weg (Papier · Π (1 − dᵢ · (1 − Farbeᵢ))). Die Deckungen dᵢ
// werden je Pixel aus der optischen Dichte −log(Bild/Papier) per kleinster Quadrate bestimmt (2 oder 3 Farben, auf
// 0..1 begrenzt). Jede Farbe wird körnig gerastert (Schwelle gegen Rauschen, eigener Seed) und mit eigenem Versatz
// gedruckt. Alles in Leinwand-Koordinaten (kachelgenau).

fn density_of(c: vec3f) -> vec3f {
  return -log(clamp(c, vec3f(0.004), vec3f(1.0)) / max(params.paper, vec3f(0.01)));
}

/** Deckungen der Farben aus der Bildfarbe (linear). */
fn separate(rgb: vec3f, n: u32) -> vec3f {
  let t = max(density_of(rgb), vec3f(0.0));
  let a = max(density_of(params.ink1), vec3f(0.02));
  let b = max(density_of(params.ink2), vec3f(0.02));
  let c = max(density_of(params.ink3), vec3f(0.02));
  if (n == 2u) {
    // 2 Unbekannte: Normalengleichungen
    let aa = dot(a, a);
    let ab = dot(a, b);
    let bb = dot(b, b);
    let at = dot(a, t);
    let bt = dot(b, t);
    let det = aa * bb - ab * ab;
    var x = vec2f(0.0);
    if (abs(det) > 1e-6) {
      x = vec2f(bb * at - ab * bt, aa * bt - ab * at) / det;
    }
    // negative Anteile auf die andere Farbe umlegen (einfache Projektion)
    if (x.x < 0.0) { x = vec2f(0.0, max(bt / max(bb, 1e-6), 0.0)); }
    if (x.y < 0.0) { x = vec2f(max(at / max(aa, 1e-6), 0.0), 0.0); }
    return vec3f(clamp(x, vec2f(0.0), vec2f(1.0)), 0.0);
  }
  // 3 Unbekannte: Gleichungssystem M·x = t mit M = [a b c] (Spalten)
  let m = mat3x3f(a, b, c);
  let det = determinant(m);
  var x = vec3f(0.0);
  if (abs(det) > 1e-6) {
    // Cramersche Regel
    x = vec3f(
      determinant(mat3x3f(t, b, c)),
      determinant(mat3x3f(a, t, c)),
      determinant(mat3x3f(a, b, t)),
    ) / det;
  }
  return clamp(x, vec3f(0.0), vec3f(1.0));
}

fn tone(p: vec2f) -> vec3f {
  let c = unpremultiply(sample_src_canvas(p * params.scale));
  var s = clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0));
  let k = params.contrast / 100.0;
  s = clamp((s - 0.5) * (1.0 + k) + 0.5, vec3f(0.0), vec3f(1.0));
  return srgb_to_linear(s);
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_pos(p);
  let n = select(2u, 3u, params.inks == 1u);
  let mis = params.misregister / params.scale;
  // Versatz je Druckgang (fest je Seed)
  let o1 = (vec2f(rand_cell(vec2i(1, 0), params.seed, 20u), rand_cell(vec2i(1, 1), params.seed, 21u)) - 0.5) * 2.0 * mis;
  let o2 = (vec2f(rand_cell(vec2i(2, 0), params.seed, 22u), rand_cell(vec2i(2, 1), params.seed, 23u)) - 0.5) * 2.0 * mis;
  let o3 = (vec2f(rand_cell(vec2i(3, 0), params.seed, 24u), rand_cell(vec2i(3, 1), params.seed, 25u)) - 0.5) * 2.0 * mis;
  // Deckung je Farbe an der versetzten Stelle (jeder Druckgang „sieht“ das Bild verschoben)
  let d1 = separate(tone(cp - o1), n).x;
  let d2 = separate(tone(cp - o2), n).y;
  let d3 = select(0.0, separate(tone(cp - o3), n).z, n == 3u);
  // körniges Raster: Schwelle gegen Rauschen (eigener Seed je Farbe)
  let g = params.grain / 100.0;
  let gs = params.grainSize;
  let r1 = rand_fbm(cp, gs * 2.0, 2u, params.seed + 101u) * 0.5 + rand_at(cp / gs, params.seed, 1u) * 0.5;
  let r2 = rand_fbm(cp, gs * 2.0, 2u, params.seed + 202u) * 0.5 + rand_at(cp / gs, params.seed, 2u) * 0.5;
  let r3 = rand_fbm(cp, gs * 2.0, 2u, params.seed + 303u) * 0.5 + rand_at(cp / gs, params.seed, 3u) * 0.5;
  let w = 0.5 * (1.0 - g) + 0.04;
  let c1 = mix(d1, smoothstep(r1 - w, r1 + w, d1), g);
  let c2 = mix(d2, smoothstep(r2 - w, r2 + w, d2), g);
  let c3 = mix(d3, smoothstep(r3 - w, r3 + w, d3), g);
  let dens = params.inkDensity / 100.0;
  var col = params.paper;
  col *= mix(vec3f(1.0), params.ink1 / max(params.paper, vec3f(0.01)), c1 * dens);
  col *= mix(vec3f(1.0), params.ink2 / max(params.paper, vec3f(0.01)), c2 * dens);
  col *= mix(vec3f(1.0), params.ink3 / max(params.paper, vec3f(0.01)), c3 * dens);
  return premultiply(vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), load_src(p).a));
}
