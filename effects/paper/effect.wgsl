// Papier: Höhenfeld aus Knittern (Voronoi-Grate F2 − F1), Faltlinien (Geraden mit Grat) und Fasern; daraus
// Schattierung mit Lichtrichtung. Das Bild wird multiplikativ „gedruckt“, Wasserflecken als Ringe mit dunklerem Rand,
// Büttenrand als ausgefranste Transparenz. Alles in Leinwand-Koordinaten bei voller Auflösung (kachelgenau).

fn paper_color() -> vec3f {
  switch params.paperType {
    case 1u: { return srgb_to_linear(vec3f(0.74, 0.6, 0.42)); }
    case 2u: { return srgb_to_linear(vec3f(0.93, 0.87, 0.72)); }
    default: { return srgb_to_linear(vec3f(0.97, 0.96, 0.94)); }
  }
}

/** Knitter-Höhe: Abstand zwischen nächstem und zweitnächstem Zellpunkt ergibt Grate wie bei zerknittertem Papier. */
fn crumple_h(x: vec2f, cell: f32, k: u32) -> f32 {
  let q = x / cell;
  let i = floor(q);
  var f1 = 9.0;
  var f2 = 9.0;
  for (var y = -1; y <= 1; y++) {
    for (var xx = -1; xx <= 1; xx++) {
      let c = i + vec2f(f32(xx), f32(y));
      let ci = vec2i(c);
      let pt = c + vec2f(rand_cell(ci, params.seed, 31u + k), rand_cell(ci, params.seed, 32u + k));
      let d = distance(q, pt);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return f2 - f1;
}

fn height(x: vec2f, canvas: vec2f) -> f32 {
  let s = min(canvas.x, canvas.y);
  var h = 0.0;
  let c = params.crumple / 100.0;
  if (c > 0.0) {
    h += c * (0.6 * crumple_h(x, s * 0.12, 0u) + 0.4 * crumple_h(x, s * 0.045, 7u));
  }
  // Faltlinien: zufällige Geraden durch die Leinwand, Höhe = Grat bzw. Kerbe
  for (var i = 0; i < 6; i++) {
    if (i >= params.folds) { break; }
    let k = u32(i) * 5u;
    let a = rand_cell(vec2i(i, 3), params.seed, 40u + k) * 3.14159265;
    let o = (vec2f(rand_cell(vec2i(i, 4), params.seed, 41u + k), rand_cell(vec2i(i, 5), params.seed, 42u + k)) * 0.6 + 0.2) * canvas;
    let n = vec2f(-sin(a), cos(a));
    let d = dot(x - o, n);
    h += 0.6 * exp(-abs(d) / (s * 0.006)) * select(1.0, -1.0, (i % 2) == 1);
  }
  // Fasern: in einer Richtung gestrecktes Rauschen
  h += params.fiber / 100.0 * 0.05 * rand_fbm(vec2f(x.x * 0.35, x.y), 3.0, 3u, params.seed + 50u);
  return h;
}

fn effect(p: vec2i) -> vec4f {
  let canvas = params.canvas_size / params.scale;
  let x = canvas_pos(p);
  let src = unpremultiply(load_src(p));
  let s = min(canvas.x, canvas.y);
  // Schattierung aus dem Gradienten des Höhenfelds (Abstand 1,5 Leinwand-px)
  let e = 1.5;
  let hx = height(x + vec2f(e, 0.0), canvas) - height(x - vec2f(e, 0.0), canvas);
  let hy = height(x + vec2f(0.0, e), canvas) - height(x - vec2f(0.0, e), canvas);
  let nrm = normalize(vec3f(-hx * s * 0.02, -hy * s * 0.02, 1.0));
  let l = normalize(vec3f(cos(params.lightAngle), sin(params.lightAngle), 1.2));
  let shade = clamp(0.25 + 0.85 * dot(nrm, l), 0.55, 1.2);
  var paper = paper_color();
  // Wasserflecken: Ringe mit dunklerem Rand und leicht verfärbtem Inneren
  for (var i = 0; i < 12; i++) {
    if (i >= params.stains) { break; }
    let k = u32(i) * 7u;
    let c = vec2f(rand_cell(vec2i(i, 9), params.seed, 60u + k), rand_cell(vec2i(i, 10), params.seed, 61u + k)) * canvas;
    let r = s * (0.05 + 0.12 * rand_cell(vec2i(i, 11), params.seed, 62u + k));
    let wob = 1.0 + 0.12 * (rand_noise(x, r * 0.4, params.seed + 70u + k) - 0.5);
    let d = distance(x, c) / (r * wob);
    let inside = 1.0 - smoothstep(0.97, 1.0, d);
    let rim = exp(-pow((d - 0.98) / 0.03, 2.0));
    paper *= mix(vec3f(1.0), vec3f(0.96, 0.92, 0.84), inside * 0.6);
    paper *= mix(vec3f(1.0), vec3f(0.8, 0.72, 0.6), rim * 0.7);
  }
  // Druck: Bild multiplikativ auf das Papier (Deckung), dann Licht und Schatten der Oberfläche
  let ink = params.ink / 100.0;
  var rgb = paper * mix(vec3f(1.0), src.rgb / max(paper_color(), vec3f(0.05)), ink);
  rgb = mix(paper, rgb, src.a) * shade;
  var a = 1.0;
  if (params.deckle != 0u) {
    let d = min(min(x.x, canvas.x - x.x), min(x.y, canvas.y - x.y));
    let edge = s * 0.025 * (0.6 + 0.8 * rand_fbm(x, s * 0.01, 4u, params.seed + 80u));
    a = smoothstep(edge * 0.6, edge, d);
    rgb *= mix(0.85, 1.0, smoothstep(edge, edge * 2.0, d));
  }
  return premultiply(vec4f(max(rgb, vec3f(0.0)), a));
}
