// Auflösende Ölfarbe. Alles in Leinwand-Koordinaten (Render-px) und aus Zufall/Rauschen je Position und Seed:
// Vorschau, Export-Kacheln und Endrender stimmen überein. Größen in % der langen Bildkante L.
//  1. Auflösungsmaske D: Verlauf in Richtung dissolveAngle + fraktales Rauschen, auf das Motiv beschränkbar.
//  2. Verwirbeln (Domänenverzerrung mit fraktalem Rauschen, zweimal) und Wischen (gerichtetes Mitteln) im Bereich D.
//  3. Löcher: Rauschschwelle, die mit D wächst; Leere in fast schwarz, an den Rändern goldenes Leuchten.
//  4. Flocken (irreguläre Fetzen) um das Motiv, Bläschen (Ring mit Glanz) in der aufgelösten Zone.
//  5. Schwärze (Schatten abdunkeln), Vignette, Pinselstruktur (Streiflicht, entlang der Wischrichtung gestreckt).

fn longest() -> f32 { return max(params.canvas_size.x, params.canvas_size.y); }

fn mirror_canvas(q: vec2f) -> vec2f {
  let cs = params.canvas_size;
  return cs - abs(cs - abs(q));
}

fn read_px(q: vec2f) -> vec4f {
  return sample_src_canvas(clamp(mirror_canvas(q), vec2f(0.5), params.canvas_size - 0.5));
}

fn read_rgb(q: vec2f) -> vec3f { return unpremultiply(read_px(q)).rgb; }

fn subject_at(q: vec2f) -> f32 {
  let size = vec2i(src_size());
  let p = clamp(vec2i(floor(q - params.origin)), vec2i(0), size - vec2i(1));
  var v = max(load_saliency(p), load_faces(p));
  if (has_focus()) { v = max(v, load_focus(p)); }
  return clamp(v, 0.0, 1.0);
}

fn drift_dir() -> vec2f { return vec2f(cos(params.dissolveAngle), sin(params.dissolveAngle)); }

/** Auflösungsmaske 0..1 */
fn dissolve_at(cp: vec2f) -> f32 {
  let cs = params.canvas_size;
  let L = longest();
  let g = clamp(dot((cp - 0.5 * cs) / L, drift_dir()) + 0.5, 0.0, 1.0);
  let n = rand_fbm(cp, 0.3 * L, 3u, params.seed + 31u);
  let f = 0.5 * g + 0.5 * n;
  let t = 1.0 - params.dissolve / 100.0 * 0.95;
  let d = smoothstep(t - 0.14, t + 0.14, f);
  let bias = params.subjectBias / 100.0;
  let sub = mix(1.0, smoothstep(0.1, 0.6, subject_at(cp)), bias);
  return d * sub;
}

fn leaf(local: vec2f, r: f32, seed_cell: vec2i, salt: u32) -> f32 {
  let ang = rand_cell(seed_cell, salt, 3u) * 6.2831853;
  let c = cos(ang);
  let s = sin(ang);
  let l = vec2f(c * local.x + s * local.y, -s * local.x + c * local.y);
  let asp = 0.35 + 0.65 * rand_cell(seed_cell, salt, 4u);
  var d = length(vec2f(l.x / r, l.y / (r * asp)));
  d += (rand_noise(local + vec2f(seed_cell) * 37.0, max(r * 0.6, 1.0), salt) - 0.5) * 0.7;
  return 1.0 - smoothstep(0.78, 1.0, d);
}

fn effect(p: vec2i) -> vec4f {
  let src0 = load_src(p);
  let cp = canvas_px(p);
  let L = longest();
  let dir = drift_dir();
  let D = dissolve_at(cp);

  // 2. Verwirbeln
  var q = cp;
  if (D > 0.001 && params.swirl > 0.0) {
    let s = params.swirlSize / 100.0 * L;
    let amp = params.swirl / 100.0 * 0.06 * L * D;
    for (var it = 0u; it < 2u; it++) {
      let nx = rand_fbm(q, s, 3u, params.seed + 11u + it * 7u) - 0.5;
      let ny = rand_fbm(q + vec2f(173.0, 91.0), s, 3u, params.seed + 12u + it * 7u) - 0.5;
      q = q + vec2f(nx, ny) * 2.0 * amp;
    }
  }
  // Wischen: einseitiges Mitteln in Richtung der Auflösung, Länge nach D und Rauschen
  var col = read_rgb(q);
  if (D > 0.001 && params.smear > 0.0) {
    let len = params.smearLength / 100.0 * L * D * (0.4 + 0.6 * rand_noise(q, 0.05 * L, params.seed + 41u));
    var sum = vec3f(0.0);
    var wsum = 0.0;
    for (var i = 0; i < 10; i++) {
      let t = f32(i) / 9.0;
      let w = 1.0 - 0.6 * t;
      sum += read_rgb(q - dir * len * t) * w;
      wsum += w;
    }
    col = mix(col, sum / wsum, params.smear / 100.0 * min(1.0, D * 1.5));
  }
  let lumBase = luminance(col);

  // 3. Löcher ins Dunkel mit goldenem Rand
  if (params.holes > 0.0 && D > 0.001) {
    let h = rand_fbm(q, 0.07 * L, 4u, params.seed + 21u);
    let thr = 1.0 - D * params.holes / 100.0 * 0.9;
    let hole = smoothstep(thr - 0.03, thr + 0.1, h) * 0.9;
    let band = smoothstep(thr - 0.12, thr - 0.02, h) * (1.0 - hole);
    col += params.goldColor * band * params.rim / 100.0 * (0.25 + 1.6 * lumBase) * 1.2;
    let voidShade = params.voidColor * (0.6 + 0.8 * rand_noise(q, 0.02 * L, params.seed + 22u));
    col = mix(col, voidShade, hole);
  }

  // Hintergrund versinkt im Dunkel (Figur taucht aus der Leere auf)
  if (params.backdrop > 0.0) {
    let keep = smoothstep(0.05, 0.55, subject_at(cp));
    col = mix(col, params.voidColor * (0.7 + 0.6 * rand_noise(cp, 0.03 * L, params.seed + 23u)), (1.0 - keep) * params.backdrop / 100.0);
  }

  var alpha = src0.a;

  // 4a. Flocken um das Motiv
  if (params.flecks > 0.0) {
    let S = max(params.fleckSize / 100.0 * L * 2.6, 6.0);
    let cell = vec2i(floor(cp / S));
    let salt = params.seed + 900u;
    let j = vec2f(rand_cell(cell, salt, 1u), rand_cell(cell, salt, 2u)) * 0.2 - 0.1;
    let centre = (vec2f(cell) + 0.5 + j) * S;
    let sal = subject_at(centre);
    let ring = smoothstep(0.02, 0.2, sal) * (1.0 - smoothstep(0.35, 0.7, sal));
    let zone = clamp(ring * 0.9 + dissolve_at(centre) * 0.35, 0.0, 1.0);
    if (rand_cell(cell, salt, 5u) < params.flecks / 100.0 * zone) {
      let r = S * (0.12 + 0.3 * rand_cell(cell, salt, 6u));
      let a = leaf(cp - centre, r, cell, salt);
      if (a > 0.0) {
        let tone = 0.35 + 0.9 * rand_cell(cell, salt, 7u);
        let pale = rand_cell(cell, salt, 8u) < 0.25;
        let fc = select(params.goldColor * tone, vec3f(0.85, 0.78, 0.66) * (0.3 + 0.5 * tone), pale);
        col = mix(col, fc, a * 0.9);
        alpha = max(alpha, a);
      }
    }
  }
  // 4b. Bläschen in der aufgelösten Zone
  if (params.bubbles > 0.0) {
    let S = max(params.fleckSize / 100.0 * L * 3.6, 8.0);
    let cell = vec2i(floor(cp / S));
    let salt = params.seed + 950u;
    let centre = (vec2f(cell) + 0.3 + 0.4 * vec2f(rand_cell(cell, salt, 1u), rand_cell(cell, salt, 2u))) * S;
    let zone = dissolve_at(centre);
    if (rand_cell(cell, salt, 3u) < params.bubbles / 100.0 * zone * 0.8) {
      let r = S * (0.1 + 0.2 * rand_cell(cell, salt, 4u));
      let l = cp - centre;
      let d = length(l);
      if (d < r * 1.1) {
        let w = max(r * 0.16, 1.0);
        let ringA = smoothstep(r - w, r - w * 0.2, d) * (1.0 - smoothstep(r - w * 0.2, r + w * 0.2, d));
        let inner = 1.0 - smoothstep(r * 0.7, r, d);
        let spot = 1.0 - smoothstep(r * 0.12, r * 0.28, length(l + vec2f(0.38, 0.38) * r));
        col = col * (1.0 + 0.25 * inner) + vec3f(0.9, 0.85, 0.75) * (ringA * 0.55 + spot * 0.9);
      }
    }
  }

  // 5. Schwärze, Vignette, Pinselstruktur
  let dark = params.darkness / 100.0;
  col = pow(max(col, vec3f(0.0)), vec3f(1.0 + dark * 0.7));
  col = col * mix(vec3f(1.0), vec3f(0.93, 0.97, 1.0), dark * 0.5 * (1.0 - smoothstep(0.0, 0.3, luminance(col))));
  if (params.vignette > 0.0) {
    let uv = (cp - 0.5 * params.canvas_size) / (0.5 * L);
    col = col * (1.0 - params.vignette / 100.0 * smoothstep(0.45, 1.25, length(uv)));
  }
  if (params.brushTexture > 0.0) {
    let c = cos(params.dissolveAngle);
    let s = sin(params.dissolveAngle);
    let rot = vec2f(c * cp.x + s * cp.y, -s * cp.x + c * cp.y);
    let sc = 0.012 * L;
    let a = rand_fbm(vec2f(rot.x * 0.25, rot.y), sc * 2.0, 3u, params.seed + 51u);
    let b = rand_fbm(vec2f((rot.x + 2.0) * 0.25, rot.y + 2.0), sc * 2.0, 3u, params.seed + 51u);
    let relief = (a - b) * 4.0;
    let lit = smoothstep(0.015, 0.25, luminance(col));
    col = col * (1.0 + relief * params.brushTexture / 100.0 * lit);
  }
  return premultiply(vec4f(max(col, vec3f(0.0)), alpha));
}
