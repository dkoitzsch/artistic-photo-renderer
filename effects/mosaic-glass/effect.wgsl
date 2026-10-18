// Mosaik & Buntglas: Voronoi-Zellen auf einem verwackelten Raster in Leinwand-Koordinaten (volle Auflösung). Zellfarbe
// = Mittel aus 7 Proben um den Zellpunkt; Fuge über den Abstand zur Grenze (F2 − F1 entlang der Verbindung). Buntglas:
// Licht scheint durch – Mitte heller, Glasstruktur verbiegt die Farbe leicht, Bleirute mit Glanzkante.

struct Cells {
  id1: vec2i,
  site1: vec2f,
  border: f32, // Abstand zur nächsten Zellgrenze (Leinwand-px)
}

fn site_of(c: vec2i, cell: f32) -> vec2f {
  let j = 1.0 - params.regularity / 100.0;
  let r = vec2f(rand_cell(c, params.seed, 1u), rand_cell(c, params.seed, 2u)) - 0.5;
  return (vec2f(c) + 0.5 + r * j * 0.9) * cell;
}

fn cells(x: vec2f, cell: f32) -> Cells {
  let base = vec2i(floor(x / cell));
  var d1 = 1e9;
  var s1 = vec2f(0.0);
  var id1 = base;
  for (var y = -2; y <= 2; y++) {
    for (var xx = -2; xx <= 2; xx++) {
      let c = base + vec2i(xx, y);
      let s = site_of(c, cell);
      let d = distance(x, s);
      if (d < d1) {
        d1 = d;
        s1 = s;
        id1 = c;
      }
    }
  }
  // Abstand zur Grenze: für jeden Nachbarn der Abstand zur Mittelsenkrechten
  var border = 1e9;
  for (var y = -2; y <= 2; y++) {
    for (var xx = -2; xx <= 2; xx++) {
      let c = base + vec2i(xx, y);
      if (all(c == id1)) { continue; }
      let s = site_of(c, cell);
      let m = 0.5 * (s1 + s);
      let n = normalize(s - s1);
      border = min(border, dot(m - x, n));
    }
  }
  return Cells(id1, s1, border);
}

fn cell_color(site: vec2f, cell: f32) -> vec3f {
  var sum = vec3f(0.0);
  for (var i = 0; i < 7; i++) {
    let a = f32(i) * 0.8976;
    let o = select(vec2f(cos(a), sin(a)) * cell * 0.25, vec2f(0.0), i == 0);
    sum += unpremultiply(sample_src_canvas((site + o) * params.scale)).rgb;
  }
  var c = sum / 7.0;
  // Farbkraft in Oklab
  var lab = oklab_from_linear(max(c, vec3f(0.0)));
  lab = vec3f(lab.x, lab.yz * params.saturation / 100.0);
  return max(linear_from_oklab(lab), vec3f(0.0));
}

fn effect(p: vec2i) -> vec4f {
  let x = canvas_pos(p);
  let cell = max(params.cellSize / params.scale, 2.0);
  let c = cells(x, cell);
  var col = cell_color(c.site1, cell);
  let t = params.texture / 100.0;
  let px = 1.0 / params.scale;
  if (params.mode == 1u) {
    // Glas: Licht in der Zellmitte heller, Struktur aus Rauschen, leichte Farbunterschiede je Scherbe
    let d = distance(x, c.site1) / cell;
    let glow = 1.0 + 0.25 * (1.0 - smoothstep(0.0, 0.7, d));
    let n = rand_fbm(x, cell * 0.12, 3u, params.seed + 9u) - 0.5;
    let tint = 1.0 + (rand_cell(c.id1, params.seed, 5u) - 0.5) * 0.25;
    col = col * glow * tint * (1.0 + n * 0.5 * t);
  } else {
    // Mosaikstein: leicht gewölbt, Oberfläche körnig
    let n = rand_at(x, params.seed, 3u) - 0.5;
    let bevel = smoothstep(0.0, cell * 0.25, c.border);
    col = col * (0.88 + 0.12 * bevel) * (1.0 + n * 0.15 * t);
  }
  // Fuge bzw. Bleirute
  let w = params.jointWidth / params.scale * 0.5;
  var joint = 1.0 - smoothstep(w - 0.6 * px, w + 0.6 * px, c.border);
  if (params.jointWidth <= 0.0) { joint = 0.0; }
  var jc = params.jointColor;
  if (params.mode == 1u) {
    // Glanzkante auf der Bleirute
    let hl = exp(-pow((c.border - w * 0.4) / max(w * 0.3, 0.5 * px), 2.0));
    jc = jc + vec3f(0.25) * hl;
  }
  col = mix(col, jc, joint);
  return premultiply(vec4f(clamp(col, vec3f(0.0), vec3f(1.5)), load_src(p).a));
}
