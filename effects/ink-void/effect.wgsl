// Schwarze Leere. Alles in Leinwand-Koordinaten (Render-px) und aus Rauschen/Zufall je Position und Seed: Vorschau,
// Export-Kacheln und Endrender stimmen überein. Größen in % der langen Bildkante L.
//  1. Feld F: Motivkarte (Gesichter, Salienz, Fokus) an domänenverwirbelter, verschobener Position + Rauschen.
//     Leere V = Schwelle über F (Größe), Randzone H = Übergang davor.
//  2. Schlieren: in H wird entlang einer Spirale (Maskengradient, zur Tangente gedreht) gemittelt.
//  3. Schwarzweiß, Silberton, Tonwertkurve (Schwarzwert, Kontrast), Randlicht aus der Kantenkarte, Kreidestruktur.
//  4. In der Leere fast Schwarz mit feinen Wirbeln; weiße Spritzer; Vignette.

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
  var v = max(load_faces(p), load_saliency(p) * 0.6);
  if (has_focus()) { v = max(v, load_focus(p) * 0.6); }
  return clamp(v, 0.0, 1.0);
}

/** Feld 0..1 (hoch = Mitte der Leere) */
fn field_at(cp: vec2f) -> f32 {
  let L = longest();
  let s = params.swirlSize / 100.0 * L;
  let t = params.turbulence / 100.0;
  let w = (vec2f(rand_fbm(cp, s, 3u, params.seed + 11u), rand_fbm(cp + vec2f(173.0, 91.0), s, 3u, params.seed + 12u)) - 0.5) * 2.0 * t * 0.12 * L;
  let q = cp + w - vec2f(params.voidShiftX, params.voidShiftY) / 100.0 * L;
  let sub = smoothstep(0.03, 0.85, subject_at(q));
  let n = rand_fbm(q, s * 0.8, 4u, params.seed + 13u);
  let bias = params.subjectBias / 100.0;
  let base = mix(rand_fbm(cp, 0.3 * L, 3u, params.seed + 14u), sub, bias);
  return clamp(base + (n - 0.5) * 0.6 * t, 0.0, 1.0);
}

fn speck(local: vec2f, r: f32, cell: vec2i, salt: u32) -> f32 {
  let ang = rand_cell(cell, salt, 3u) * 6.2831853;
  let c = cos(ang);
  let s = sin(ang);
  let l = vec2f(c * local.x + s * local.y, -s * local.x + c * local.y);
  let asp = 0.3 + 0.7 * rand_cell(cell, salt, 4u);
  let d = length(vec2f(l.x / r, l.y / (r * asp)));
  return 1.0 - smoothstep(0.55, 1.0, d);
}

fn effect(p: vec2i) -> vec4f {
  let src0 = load_src(p);
  let cp = canvas_px(p);
  let L = longest();
  let F = field_at(cp);
  let thr = 1.0 - params.coverage / 100.0 * 0.85;
  let V = smoothstep(thr - 0.04, thr + 0.04, F);
  let H = smoothstep(thr - 0.45, thr, F) * (1.0 - V);

  var col = unpremultiply(src0).rgb;

  // 2. Schlieren in der Randzone
  if (params.tendrils > 0.0 && (H > 0.002 || V > 0.002)) {
    let e = max(1.0, 0.004 * L);
    let gx = field_at(cp + vec2f(e, 0.0)) - field_at(cp - vec2f(e, 0.0));
    let gy = field_at(cp + vec2f(0.0, e)) - field_at(cp - vec2f(0.0, e));
    var g = vec2f(gx, gy);
    let gl = length(g);
    if (gl > 1e-5) {
      g = g / gl;
      let tang = vec2f(-g.y, g.x);
      let d = normalize(mix(g, tang, 0.75));
      let len = params.tendrilLength / 100.0 * L * clamp(H * 2.0 + V * 0.5, 0.0, 1.0) * (0.6 + 1.2 * rand_noise(cp, 0.04 * L, params.seed + 41u));
      var sum = vec3f(0.0);
      var ws = 0.0;
      for (var i = 0; i < 12; i++) {
        let t = f32(i) / 11.0;
        let w = 1.0 - 0.7 * t;
        sum += read_rgb(cp + d * len * t) * w;
        ws += w;
      }
      col = mix(col, sum / ws, params.tendrils / 100.0 * clamp(H * 2.0 + V * 0.5, 0.0, 1.0));
    }
  }

  // 3. Schwarzweiß, Silberton, Tonwertkurve
  let lum0 = luminance(col);
  let gray = vec3f(lum0);
  col = mix(col, gray, params.mono / 100.0);
  col = mix(col, col * params.tint / max(luminance(params.tint), 0.1), params.tintAmount / 100.0 * params.mono / 100.0);
  var s = clamp(linear_to_srgb(max(col, vec3f(0.0))), vec3f(0.0), vec3f(1.0));
  let bp = params.blackPoint / 100.0 * 0.4;
  s = clamp((s - bp) / (1.0 - bp), vec3f(0.0), vec3f(1.0));
  s = mix(s, s * s * (3.0 - 2.0 * s), params.contrast / 100.0);
  let sl = luminance(srgb_to_linear(s));

  // Hintergrund versinkt im Schwarz (außerhalb des Motivs)
  if (params.backdrop > 0.0) {
    let keep = smoothstep(0.04, 0.5, subject_at(cp));
    s = mix(s, s * 0.06, (1.0 - keep) * params.backdrop / 100.0);
  }
  // Randlicht
  if (params.rim > 0.0) {
    let edge = edge_strength(p);
    s = s + vec3f(0.85, 0.92, 1.0) * edge * params.rim / 100.0 * 0.7 * smoothstep(0.12, 0.55, sl);
  }
  // Kreidestruktur: trockener Pinsel in den Lichtern
  if (params.chalk > 0.0) {
    let n = rand_fbm(vec2f(cp.x * 0.25, cp.y), 0.004 * L, 4u, params.seed + 51u);
    s = s * (1.0 - params.chalk / 100.0 * 0.6 * smoothstep(0.42, 0.72, n) * smoothstep(0.25, 0.8, sl));
  }

  // 4. Leere
  let tone = rand_fbm(cp, 0.025 * L, 3u, params.seed + 61u);
  let shade = vec3f(0.012 + 0.07 * tone * tone);
  s = mix(s, shade, V);

  // Spritzer
  if (params.specks > 0.0) {
    let S = max(0.014 * L, 5.0);
    let cell = vec2i(floor(cp / S));
    let salt = params.seed + 970u;
    let j = vec2f(rand_cell(cell, salt, 1u), rand_cell(cell, salt, 2u)) * 0.4 - 0.2;
    let centre = (vec2f(cell) + 0.5 + j) * S;
    let fc = field_at(centre);
    let zone = smoothstep(thr - 0.22, thr - 0.02, fc);
    if (rand_cell(cell, salt, 5u) < params.specks / 100.0 * zone * 0.55) {
      let r = S * (0.08 + 0.22 * rand_cell(cell, salt, 6u) * rand_cell(cell, salt, 7u));
      let a = speck(cp - centre, r, cell, salt);
      s = mix(s, vec3f(0.55 + 0.45 * rand_cell(cell, salt, 8u)), a);
    }
  }

  if (params.vignette > 0.0) {
    let uv = (cp - 0.5 * params.canvas_size) / (0.5 * L);
    s = s * (1.0 - params.vignette / 100.0 * smoothstep(0.45, 1.25, length(uv)));
  }
  return premultiply(vec4f(srgb_to_linear(clamp(s, vec3f(0.0), vec3f(1.0))), src0.a));
}
