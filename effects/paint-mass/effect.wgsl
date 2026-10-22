// Dicke Farbmasse. Alles in Leinwand-Koordinaten (Render-px), Rauschen und Zufall je Position und Seed: Vorschau,
// Export-Kacheln und Endrender stimmen überein. Größen in % der langen Bildkante L.
//  1. Maske M: Feld aus Motiv (Gesichter/Salienz/Fokus), Richtung und Rauschen, per Schwelle (Ausdehnung) mit
//     zerfranster Kante.
//  2. Höhenfeld: Ridge-Rauschen, entlang ridgeAngle gestreckt und verwirbelt; die Masse ist ein erhabenes Plateau, ihre
//     Kante bildet eine Lippe. Streiflicht (Lambert + Glanz), Risse in den Tälern.
//  3. Farbe der Masse: aus dem Bild entlang der Furchen gewischt, zur Eigenfarbe (bei gleicher Helligkeit) gezogen.
//  4. Tropfen: senkrechte Läufe unter der Masse; Flocken: losgelöste Fetzen an der Kante der Masse.

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
  var v = max(load_faces(p), load_saliency(p) * 0.7);
  if (has_focus()) { v = max(v, load_focus(p) * 0.7); }
  return clamp(v, 0.0, 1.0);
}

fn mass_dir() -> vec2f { return vec2f(cos(params.massAngle), sin(params.massAngle)); }

/** Maske 0..1; soft = weiche Kante (für das Höhenfeld), sonst scharf mit Fransen */
fn mass_at(cp: vec2f, soft: bool) -> f32 {
  if (params.coverage <= 0.0) { return 0.0; }
  let cs = params.canvas_size;
  let L = longest();
  let g = clamp(dot((cp - 0.5 * cs) / L, mass_dir()) + 0.5, 0.0, 1.0);
  let n = rand_fbm(cp, 0.25 * L, 3u, params.seed + 61u);
  let s = smoothstep(0.05, 0.7, subject_at(cp));
  let bias = params.subjectBias / 100.0;
  let f = mix(0.55 * g + 0.45 * n, 0.2 * g + 0.55 * s + 0.25 * n, bias);
  let rag = (rand_fbm(cp, 0.03 * L, 4u, params.seed + 62u) - 0.5) * params.raggedness / 100.0 * 0.55;
  let t = 1.0 - params.coverage / 100.0 * 0.85;
  let w = select(0.025, 0.07, soft);
  return smoothstep(t - w, t + w, f + rag);
}

/** Furchenhöhe 0..1 (Ridge-Rauschen, gestreckt und verwirbelt) */
fn ridge_at(cp: vec2f) -> f32 {
  let L = longest();
  let cell = params.ridgeSize / 100.0 * L;
  let wv = vec2f(rand_fbm(cp, 4.0 * cell, 2u, params.seed + 71u), rand_fbm(cp + vec2f(91.0, 37.0), 4.0 * cell, 2u, params.seed + 72u)) - 0.5;
  let w = cp + wv * 2.0 * params.ridgeWarp / 100.0 * 0.1 * L;
  let c = cos(params.ridgeAngle);
  let s = sin(params.ridgeAngle);
  let r = vec2f(c * w.x + s * w.y, -s * w.x + c * w.y);
  let q = vec2f(r.x * 0.5, r.y);
  var h = 0.0;
  var amp = 0.55;
  var norm = 0.0;
  var sz = cell;
  for (var o = 0u; o < 4u; o++) {
    let n = rand_noise(q, sz, params.seed + 80u + o * 17u);
    let rd = 1.0 - abs(2.0 * n - 1.0);
    h += amp * (0.4 * rd + 0.6 * n);
    norm += amp;
    amp *= 0.5;
    sz *= 0.5;
  }
  return h / norm;
}

/** Gesamthöhe: weiches Plateau der Masse mit Furchen */
fn height_at(cp: vec2f) -> f32 {
  let m = mass_at(cp, true);
  return m * (0.5 + 0.5 * ridge_at(cp));
}

fn flake_d(local: vec2f, r: f32, cell: vec2i, salt: u32) -> f32 {
  let ang = rand_cell(cell, salt, 3u) * 6.2831853;
  let c = cos(ang);
  let s = sin(ang);
  let l = vec2f(c * local.x + s * local.y, -s * local.x + c * local.y);
  let asp = 0.35 + 0.65 * rand_cell(cell, salt, 4u);
  var d = length(vec2f(l.x / r, l.y / (r * asp)));
  d += (rand_noise(local + vec2f(cell) * 37.0, max(r * 0.5, 1.0), salt) - 0.5) * 0.8;
  return d;
}

fn paint_color(q: vec2f, dirr: vec2f, len: f32) -> vec3f {
  var base = read_rgb(q);
  if (params.smear > 0.0) {
    var sum = vec3f(0.0);
    for (var i = -5; i <= 5; i++) {
      sum += read_rgb(q + dirr * len * f32(i) / 5.0);
    }
    base = mix(base, sum / 11.0, params.smear / 100.0);
  }
  let lb = max(luminance(base), 1e-4);
  let lt = max(luminance(params.tint), 1e-4);
  return mix(base, params.tint * (lb / lt), params.tintAmount / 100.0);
}

fn effect(p: vec2i) -> vec4f {
  let src0 = load_src(p);
  let cp = canvas_px(p);
  let L = longest();
  let rdir = vec2f(cos(params.ridgeAngle), sin(params.ridgeAngle));
  let ld = vec2f(cos(params.lightAngle), sin(params.lightAngle));
  var col = unpremultiply(src0).rgb;
  var alpha = src0.a;
  let M = mass_at(cp, false);

  // Tropfen: Spalten unter der Masse
  if (params.drips > 0.0 && M < 0.5) {
    let w = max(0.013 * L, 4.0);
    let colId = i32(floor(cp.x / w));
    let salt = params.seed + 990u;
    if (rand_cell(vec2i(colId, 0), salt, 1u) < params.drips / 100.0 * 0.45) {
      let ell = params.dripLength / 100.0 * L * (0.35 + 0.65 * rand_cell(vec2i(colId, 0), salt, 2u));
      let hw = max(w * (0.22 + 0.25 * rand_cell(vec2i(colId, 0), salt, 3u)), 1.6);
      let cx = (f32(colId) + 0.5 + (rand_cell(vec2i(colId, 0), salt, 4u) - 0.5) * 0.5) * w
             + sin(cp.y / (0.05 * L) + rand_cell(vec2i(colId, 0), salt, 5u) * 6.0) * hw * 0.35;
      let step = ell / 9.0;
      for (var j = 1; j <= 9; j++) {
        let yy = cp.y - f32(j) * step;
        if (mass_at(vec2f(cx, yy), false) > 0.5) {
          let d = f32(j) * step;
          let t = d / ell;
          let width = hw * (1.0 - 0.7 * smoothstep(0.3, 1.0, t)) * (1.0 + 0.5 * smoothstep(0.85, 1.0, t) * 0.0);
          let u = (cp.x - cx) / max(width, 0.5);
          if (abs(u) < 1.0) {
            let top = vec2f(cx, yy - step * 0.5);
            var dc = paint_color(top, rdir, params.smearLength / 100.0 * L);
            let shade = 0.55 + 0.6 * (1.0 - u * u) + 0.5 * exp(-pow((u + 0.45) / 0.25, 2.0)) * params.gloss / 100.0;
            dc = dc * shade;
            col = mix(col, dc, smoothstep(1.0, 0.7, abs(u)));
          }
          break;
        }
      }
    }
  }

  if (M > 0.001) {
    // Beleuchtung aus dem Höhenfeld
    let e = max(1.0, 0.0018 * L);
    let h0 = height_at(cp);
    let hx = height_at(cp + vec2f(e, 0.0));
    let hy = height_at(cp + vec2f(0.0, e));
    let k = params.thickness / 100.0 * 55.0 * (L / (8.0 * e * 100.0)) * 8.0;
    let nrm = normalize(vec3f(-(hx - h0) * k, -(hy - h0) * k, 1.0));
    let lv = normalize(vec3f(ld * 0.7, 0.75));
    let diff = max(dot(nrm, lv), 0.0);
    let hv = normalize(lv + vec3f(0.0, 0.0, 1.0));
    let spec = pow(max(dot(nrm, hv), 0.0), 36.0) * params.gloss / 100.0;
    let rd = ridge_at(cp);
    let base = paint_color(cp, rdir, params.smearLength / 100.0 * L);
    var lit = base * (0.8 + 0.4 * rd);
    let thick = params.thickness / 100.0;
    lit = lit * mix(1.0, 0.4 + 1.1 * diff, thick);
    let crack = (1.0 - smoothstep(0.12, 0.3, rd)) * params.crevices / 100.0;
    lit = lit * (1.0 - 0.8 * crack);
    lit += vec3f(1.0, 0.95, 0.88) * spec * (0.15 + luminance(base)) * 1.5;
    col = mix(col, lit, M);
  }

  // Flocken an der Kante der Masse
  if (params.flakes > 0.0) {
    let S = max(params.flakeSize / 100.0 * L * 2.6, 6.0);
    let cell = vec2i(floor(cp / S));
    let salt = params.seed + 940u;
    let j = vec2f(rand_cell(cell, salt, 1u), rand_cell(cell, salt, 2u)) * 0.2 - 0.1;
    let centre = (vec2f(cell) + 0.5 + j) * S;
    let ms = mass_at(centre, true);
    let zone = smoothstep(0.02, 0.35, ms) * (1.0 - smoothstep(0.8, 1.0, ms));
    if (rand_cell(cell, salt, 5u) < params.flakes / 100.0 * zone * 1.6) {
      let r = S * (0.14 + 0.3 * rand_cell(cell, salt, 6u));
      let local = cp - centre;
      let d = flake_d(local, r, cell, salt);
      let a = 1.0 - smoothstep(0.78, 1.0, d);
      if (a > 0.0) {
        var fc = paint_color(centre, rdir, params.smearLength / 100.0 * L) * (0.7 + 0.6 * rand_cell(cell, salt, 7u));
        let lit = dot(normalize(local + vec2f(1e-3)), ld);
        let edge = smoothstep(0.45, 0.95, d);
        fc = fc * (1.0 + 0.6 * edge * lit) * (1.0 - 0.3 * edge * (1.0 - lit));
        col = mix(col, fc, a);
        alpha = max(alpha, a);
      }
    }
  }
  return premultiply(vec4f(max(col, vec3f(0.0)), alpha));
}
