// Scheiben-Versatz. Das Foto bleibt fotografisch: Pixel werden nur von verschobenen Stellen gelesen.
//  1. Scheiben: waagerechte Bänder unregelmäßiger Höhe, je Band Segmente zufälliger Länge; ein aktives Segment liest
//     um dx verschoben (viele kleine, wenige große Versätze).
//  2. Rechtecke: zwei Raster (groß, klein), in jeder Zelle ein Rechteck zufälliger Lage und Form, das von einer
//     versetzten Stelle liest und die Scheibe darunter überdeckt.
//  3. Streifenzug: in Streifen-Segmenten werden Spalten wiederholt (senkrechte Streifen).
//  Aktivität je Segment/Zelle: Menge × Motiv (Salienz, Gesichter, Fokuskarte) × Zusammenballung (weiches Rauschen).
//  Alles in Leinwand-Koordinaten und mit Zufall je Zelle und Seed: Vorschau, Kacheln und Endrender stimmen überein.
//  Senkrechte Richtung: Koordinaten vertauschen (u = cp.yx), am Ende zurücktauschen.

fn swap2(v: vec2f, vert: bool) -> vec2f { return select(v, v.yx, vert); }

/** an den Leinwandrändern spiegeln (keine verschmierten Randstreifen) */
fn mirror_canvas(q: vec2f) -> vec2f {
  let cs = params.canvas_size;
  let a = abs(q);
  return cs - abs(cs - a);
}

fn read_px(q: vec2f) -> vec4f {
  return sample_src_canvas(clamp(mirror_canvas(q), vec2f(0.5), params.canvas_size - 0.5));
}

/** Motivwert 0..1 an einer Leinwandposition */
fn subject_at(q: vec2f) -> f32 {
  let size = vec2i(src_size());
  let p = clamp(vec2i(floor(q - params.origin)), vec2i(0), size - vec2i(1));
  var v = max(load_saliency(p), load_faces(p));
  if (has_focus()) { v = max(v, load_focus(p)); }
  return clamp(v, 0.0, 1.0);
}

/** Aktivität 0..1 an einer Leinwandposition (Menge, Motivbezug, Nester) */
fn activity(q: vec2f) -> f32 {
  let bias = params.subjectBias / 100.0;
  let subj = mix(1.0, 0.12 + 0.88 * smoothstep(0.05, 0.6, subject_at(q)), bias);
  let cs = params.canvas_size;
  let nz = rand_noise(q, max(cs.y, cs.x) * 0.18, params.seed + 77u);
  let clu = mix(1.0, smoothstep(0.3, 0.72, nz), params.clusters / 100.0);
  return clamp(params.amount / 100.0 * 3.2 * subj * clu, 0.0, 1.0);
}

/** Scheiben-Versatz (u-Raum): x-Versatz oder 0; w = 1 bei aktiver Scheibe */
fn slice_off(u: vec2f, ud: vec2f, vert: bool) -> vec2f {
  if (params.slices <= 0.0) { return vec2f(0.0); }
  let hmin = max(params.sliceMin / 100.0 * ud.y, 1.0);
  let hmax = max(params.sliceMax / 100.0 * ud.y, hmin);
  let coarseH = hmax * 3.0;
  let coarse = floor(u.y / coarseH);
  let kk = max(1.0, round(hmax / hmin));
  let h = hmin * (1.0 + floor(rand_cell(vec2i(i32(coarse), 0), params.seed + 601u, 1u) * kk));
  let r = floor((u.y - coarse * coarseH) / h);
  let row = i32(coarse) * 128 + i32(r);
  let rowMid = coarse * coarseH + (r + 0.5) * h;
  let len = max(params.sliceLength / 100.0 * ud.x * (0.3 + 1.4 * rand_cell(vec2i(row, 1), params.seed + 602u, 2u)), 4.0);
  let phase = rand_cell(vec2i(row, 2), params.seed + 603u, 3u) * len;
  let seg = floor((u.x + phase) / len);
  let x0 = seg * len - phase;
  let id = vec2i(i32(seg), row);
  let act = activity(swap2(vec2f(x0 + len * 0.5, rowMid), vert));
  if (rand_cell(id, params.seed + 604u, 4u) >= act * params.slices / 100.0) { return vec2f(0.0); }
  let m = rand_cell(id, params.seed + 605u, 5u);
  let sgn = select(-1.0, 1.0, rand_cell(id, params.seed + 606u, 6u) < 0.5);
  return vec2f(sgn * params.shift / 100.0 * ud.x * (0.15 + 0.85 * m * sqrt(m)), 1.0);
}

/** Rechteck-Versatz (u-Raum): xy = Versatz, z = 1 wenn u in einem aktiven Rechteck liegt */
fn block_off(u: vec2f, ud: vec2f, vert: bool) -> vec3f {
  if (params.blocks <= 0.0) { return vec3f(0.0); }
  let base = params.blockSize / 100.0 * max(ud.x, ud.y);
  var res = vec3f(0.0);
  for (var g = 0; g < 2; g++) {
    let S = max(base * select(1.0, 0.33, g == 1), 4.0);
    let cell = vec2i(floor(u / S));
    let salt = params.seed + 700u + u32(g) * 50u;
    let c0 = vec2f(cell) * S;
    let rx = rand_cell(cell, salt, 1u) * 0.3;
    let rw = 0.35 + 0.65 * rand_cell(cell, salt, 2u);
    let ry = rand_cell(cell, salt, 3u) * 0.5;
    let rh = 0.2 + 0.6 * rand_cell(cell, salt, 4u);
    let f = (u - c0) / S;
    if (f.x < rx || f.x > rx + rw || f.y < ry || f.y > ry + rh) { continue; }
    let act = activity(swap2(c0 + vec2f(rx + rw * 0.5, ry + rh * 0.5) * S, vert));
    if (rand_cell(cell, salt, 5u) >= act * params.blocks / 100.0 * select(1.0, 0.8, g == 1)) { continue; }
    let sgn = select(-1.0, 1.0, rand_cell(cell, salt, 6u) < 0.5);
    let dx = sgn * params.shift / 100.0 * ud.x * (0.25 + 1.0 * rand_cell(cell, salt, 7u));
    let dy = (rand_cell(cell, salt, 8u) - 0.5) * S * 0.6;
    res = vec3f(dx, dy, 1.0);
  }
  return res;
}

/** Streifenzug (u-Raum): Spalte, aus der gelesen wird (x), oder -1 */
fn stripe_x(u: vec2f, ud: vec2f, vert: bool) -> f32 {
  if (params.stripes <= 0.0) { return -1.0; }
  let bh = max(params.sliceMin / 100.0 * ud.y, 2.0) * 1.5;
  let row = i32(floor(u.y / bh));
  let len = max(params.sliceLength / 100.0 * ud.x * 0.6 * (0.3 + 1.4 * rand_cell(vec2i(row, 3), params.seed + 801u, 1u)), 8.0);
  let phase = rand_cell(vec2i(row, 4), params.seed + 802u, 2u) * len;
  let seg = floor((u.x + phase) / len);
  let x0 = seg * len - phase;
  let id = vec2i(i32(seg), row);
  let act = activity(swap2(vec2f(x0 + len * 0.5, (f32(row) + 0.5) * bh), vert));
  if (rand_cell(id, params.seed + 803u, 3u) >= act * params.stripes / 100.0) { return -1.0; }
  let cw = max(params.stripeWidth / 100.0 * ud.x * (0.4 + 1.2 * rand_cell(id, params.seed + 804u, 4u)), 1.0);
  return x0 + floor((u.x - x0) / cw) * cw + cw * 0.5;
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_px(p);
  let vert = params.direction == 1u;
  let u = swap2(cp, vert);
  let ud = swap2(params.canvas_size, vert);

  var q = u;
  var moved = false;
  let s = slice_off(u, ud, vert);
  if (s.y > 0.5) { q = u + vec2f(s.x, 0.0); moved = true; }
  let b = block_off(u, ud, vert);
  if (b.z > 0.5) { q = u + b.xy; moved = true; }
  let sx = stripe_x(q, ud, vert);
  if (sx >= 0.0) { q = vec2f(sx, q.y); moved = true; }

  let qc = swap2(q, vert);
  var c = read_px(qc);
  if (moved && params.rgbShift > 0.0) {
    let d = swap2(vec2f(params.rgbShift / 100.0 * ud.x, 0.0), vert);
    c.r = read_px(qc + d).r;
    c.b = read_px(qc - d).b;
  }
  return c;
}
