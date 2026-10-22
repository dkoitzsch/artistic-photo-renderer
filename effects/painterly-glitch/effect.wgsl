// Malerischer Glitch. Alles in Leinwand-Koordinaten (Render-px) und mit Zufall je Zelle und Seed, damit Vorschau,
// Export-Kacheln und Endrender übereinstimmen.
//  1. Adaptives Blockraster (Quadtree-Art): ab dem größten Block teilt sich eine Zelle, solange ihr Kontrast die
//     Schwelle übersteigt (Detail, Motivschutz senkt die Schwelle) und der kleinste Block nicht unterschritten wird.
//  2. Je Block: Mittelwert (mit Restdetail), verschoben (Inhalt von versetzter Stelle, Farbkanäle gegeneinander), oder
//     Ausfall in fester Farbe.
//  3. Streifen: waagerechte (oder senkrechte) Balken in Segmenten zufälliger Länge; jedes Segment zieht die Farbe seines
//     Anfangs entlang der Länge (Pixelzeilen bzw. flache Pinselbalken), teils mit durchlaufender Farbe (Regenbogen).
//  4. Rauschen. Motiv (Salienz, Gesichter, Fokuskarte) bekommt kleinere Blöcke und weniger Störung.

const MAX_LEVELS = 6;

fn canvas_limit() -> vec2f { return params.canvas_size; }

/** Größenangaben in % der langen Bildkante → Render-px (gleicher Look bei jeder Auflösung) */
fn pct(v: f32) -> f32 { return v / 100.0 * max(params.canvas_size.x, params.canvas_size.y); }

/** Farbe (unvormultipliziert, linear) an einer Leinwandposition; auf die Leinwand geklemmt (keine Randartefakte je Kachel). */
fn read_canvas(q: vec2f) -> vec3f {
  let c = unpremultiply(sample_src_canvas(clamp(q, vec2f(0.5), canvas_limit() - 0.5)));
  return c.rgb;
}

/** Schutzwert 0..1 an einer Leinwandposition (Salienz, Gesichter, Fokuskarte). */
fn protection_at(q: vec2f) -> f32 {
  if (params.protect <= 0.0) { return 0.0; }
  let size = vec2i(src_size());
  let p = clamp(vec2i(floor(q - params.origin)), vec2i(0), size - vec2i(1));
  var v = max(load_saliency(p), load_faces(p));
  if (has_focus()) { v = max(v, load_focus(p)); }
  return clamp(v, 0.0, 1.0);
}

/** wahrnehmungsnahe Helligkeit für den Kontrast */
fn perceptual(c: vec3f) -> f32 { return pow(max(luminance(c), 0.0), 0.45); }

/** Kontrast (größte − kleinste Helligkeit) auf 3×3 Stichproben einer Zelle */
fn cell_range(c0: vec2f, size: f32) -> f32 {
  var lo = 10.0;
  var hi = -10.0;
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 3; i++) {
      let q = c0 + (vec2f(f32(i), f32(j)) + 0.5) / 3.0 * size;
      let l = perceptual(read_canvas(q));
      lo = min(lo, l);
      hi = max(hi, l);
    }
  }
  return hi - lo;
}

/** Mittelwert über 4×4 Stichproben einer Zelle, um off verschoben */
fn block_mean(c0: vec2f, size: f32, off: vec2f) -> vec3f {
  var s = vec3f(0.0);
  for (var j = 0; j < 4; j++) {
    for (var i = 0; i < 4; i++) {
      s += read_canvas(c0 + (vec2f(f32(i), f32(j)) + 0.5) / 4.0 * size + off);
    }
  }
  return s / 16.0;
}

/** Block mit Restdetail: Mittelwert und Originalpixel gemischt, beides an der um off verschobenen Stelle */
fn block_sample(c0: vec2f, size: f32, cp: vec2f, off: vec2f) -> vec3f {
  let keep = params.keep / 100.0;
  let flat = block_mean(c0, size, off);
  if (keep <= 0.0) { return flat; }
  return mix(flat, read_canvas(cp + off), keep);
}

/** Versatz eines Blocks: überwiegend entlang der Hauptrichtung */
fn block_offset(cell: vec2i, salt: u32, vert: bool) -> vec2f {
  let mag = pct(params.shift) * (0.25 + 0.75 * rand_cell(cell, salt, 11u));
  let sgn = select(-1.0, 1.0, rand_cell(cell, salt, 12u) < 0.5);
  let cross = (rand_cell(cell, salt, 13u) - 0.5) * pct(params.shift) * 0.25;
  let main = mag * sgn;
  return select(vec2f(main, cross), vec2f(cross, main), vert);
}

fn is_vertical(cp: vec2f) -> bool {
  if (params.direction == 0u) { return false; }
  if (params.direction == 1u) { return true; }
  // gemischt: große Felder mit jeweils einer Richtung
  let f = vec2i(floor(cp / max(pct(params.maxBlock) * 3.0, 1.0)));
  return rand_cell(f, params.seed + 313u, 14u) < 0.5;
}

fn hue_rotate(rgb: vec3f, t: f32) -> vec3f {
  let lab = oklab_from_linear(rgb);
  let h = atan2(lab.z, lab.y) + t * 6.2831853;
  let c = max(length(lab.yz) * 1.5, 0.14);
  let l = clamp(lab.x, 0.5, 0.88);
  return max(linear_from_oklab(vec3f(l, c * cos(h), c * sin(h))), vec3f(0.0));
}

/** Streifen an der Position cp (Koordinaten in der Zugrichtung: u.x entlang, u.y quer). Liefert (Farbe, aktiv). */
fn streak(cp: vec2f, vert: bool) -> vec4f {
  let u = select(cp, cp.yx, vert);
  let bh = max(pct(params.barHeight), 1.0);
  // Zeilenhöhen wechseln je Feld aus 8 Basishöhen: unregelmäßige Balken
  let coarse = floor(u.y / (bh * 8.0));
  let cstart = coarse * bh * 8.0;
  let h = bh * (1.0 + floor(rand_cell(vec2i(i32(coarse), 0), params.seed + 501u, 6u) * 4.0));
  let r = floor((u.y - cstart) / h);
  let rowId = i32(coarse) * 64 + i32(r);
  let rowY0 = cstart + r * h;
  let len = max(pct(params.smear) * (0.25 + 1.5 * rand_cell(vec2i(rowId, 1), params.seed + 502u, 7u)), 4.0);
  let phase = rand_cell(vec2i(rowId, 2), params.seed + 503u, 8u) * len;
  let seg = floor((u.x + phase) / len);
  let x0 = seg * len - phase;
  let id = vec2i(i32(seg), rowId);
  // Schutz am Segmentmittelpunkt
  let mid = vec2f(x0 + len * 0.5, rowY0 + h * 0.5);
  let prot = protection_at(select(mid, mid.yx, vert));
  let chance = params.streaks / 100.0 * (1.0 - params.protect / 100.0 * prot * 0.95);
  if (rand_cell(id, params.seed + 504u, 9u) >= chance) { return vec4f(0.0); }
  // Farbe: Anfang des Segments entlang der Zeile bzw. Mittel der Balkenhöhe
  let startQ = vec2f(max(x0, 0.0) + 0.5, u.y);
  let line = read_canvas(select(startQ, startQ.yx, vert));
  var bar = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let q = vec2f(max(x0, 0.0) + 0.5, rowY0 + (f32(k) + 0.5) / 4.0 * h);
    bar += read_canvas(select(q, q.yx, vert));
  }
  bar = bar / 4.0;
  var col = mix(line, bar, params.painterly / 100.0);
  // Regenbogen: Farbton läuft über das Segment
  if (rand_cell(id, params.seed + 505u, 10u) < params.rainbow / 100.0) {
    col = hue_rotate(col, (u.x - x0) / (len * 0.5) + rand_cell(id, params.seed + 506u, 15u));
  }
  return vec4f(col, 1.0);
}

fn effect(p: vec2i) -> vec4f {
  let orig = load_src(p);
  if (orig.a <= 0.0) { return vec4f(0.0); }
  let cp = canvas_px(p);
  let vert = is_vertical(cp);
  let protect = params.protect / 100.0;

  // 1. adaptives Blockraster
  let minB = min(pct(params.minBlock), pct(params.maxBlock));
  var size = pct(params.maxBlock);
  var cell = vec2i(floor(cp / size));
  var level = 0u;
  for (var l = 0; l < MAX_LEVELS; l++) {
    if (size * 0.5 < minB) { break; }
    let c0 = vec2f(cell) * size;
    let prot = protection_at(c0 + size * 0.5);
    let jitter = 0.7 + 0.6 * rand_cell(cell, params.seed + u32(l) * 131u, 1u);
    let thr = mix(0.5, 0.03, params.detail / 100.0) * jitter / (1.0 + 3.0 * protect * prot);
    if (cell_range(c0, size) <= thr) { break; }
    size = size * 0.5;
    cell = vec2i(floor(cp / size));
    level = level + 1u;
  }
  let salt = params.seed + level * 131u;
  let c0 = vec2f(cell) * size;
  let prot = protection_at(c0 + size * 0.5);
  let calm = 1.0 - protect * prot * 0.95;

  // 2. Block: Ausfall, verschoben oder normal
  var col: vec3f;
  let rDrop = rand_cell(cell, salt, 3u);
  let rShift = rand_cell(cell, salt, 2u);
  if (rDrop < params.dropout / 100.0 * calm) {
    col = params.dropoutColor;
  } else if (rShift < params.glitch / 100.0 * calm) {
    let off = block_offset(cell, salt, vert);
    col = block_sample(c0, size, cp, off);
    if (pct(params.rgbShift) > 0.0) {
      let d = select(vec2f(pct(params.rgbShift), 0.0), vec2f(0.0, pct(params.rgbShift)), vert);
      col.r = block_sample(c0, size, cp, off + d).r;
      col.b = block_sample(c0, size, cp, off - d).b;
    }
  } else {
    col = block_sample(c0, size, cp, vec2f(0.0));
  }

  // 3. Streifen
  if (params.streaks > 0.0) {
    let s = streak(cp, vert);
    if (s.a > 0.0) { col = s.rgb; }
  }

  // 4. Rauschen
  if (params.noise > 0.0) {
    let n = rand_at(canvas_pos(p), params.seed, 21u) - 0.5;
    col = col * (1.0 + n * params.noise / 100.0 * 0.7 * calm);
  }
  return premultiply(vec4f(max(col, vec3f(0.0)), orig.a));
}
