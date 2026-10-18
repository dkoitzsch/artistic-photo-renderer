// Pointillismus: Tupfer auf einem verwackelten Raster in Leinwand-Koordinaten (Zelle = Tupferabstand). Je Zelle zwei
// Lagen mit eigenem Zufall; ein Pixel nimmt den obersten Tupfer, der ihn bedeckt (Reihenfolge nach Zufallstiefe).
// Tupferfarbe = Bildfarbe am Tupfermittelpunkt, in Oklab variiert, optional auf die nächste Palettenfarbe gerundet.

fn dot_color(center: vec2f, cell: vec2i, layer: u32) -> vec3f {
  let c = unpremultiply(sample_src_canvas(center * params.scale));
  var lab = oklab_from_linear(max(c.rgb, vec3f(0.0)));
  let v = params.variation / 100.0;
  let r = vec3f(
    rand_cell(cell, params.seed, 10u + layer),
    rand_cell(cell, params.seed, 11u + layer),
    rand_cell(cell, params.seed, 12u + layer),
  ) - 0.5;
  lab += vec3f(r.x * 0.12, r.y * 0.14, r.z * 0.14) * v;
  var rgb = max(linear_from_oklab(lab), vec3f(0.0));
  if (params.usePalette != 0u) {
    // die zwei nächstliegenden Palettenfarben (Oklab); der Tupfer nimmt zufällig eine davon, gewichtet nach Abstand –
    // aus der Entfernung mischt das Auge den Zwischenton (Divisionismus)
    var d1 = 1e9;
    var d2 = 1e9;
    var c1 = rgb;
    var c2 = rgb;
    for (var i = 0u; i < params.palette_count; i++) {
      let pc = params.palette[i].rgb;
      let d = distance(oklab_from_linear(pc), lab);
      if (d < d1) {
        d2 = d1;
        c2 = c1;
        d1 = d;
        c1 = pc;
      } else if (d < d2) {
        d2 = d;
        c2 = pc;
      }
    }
    let w2 = d1 / max(d1 + d2, 1e-6);
    rgb = select(c1, c2, rand_cell(cell, params.seed, 20u + layer) < w2);
  }
  return rgb;
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_pos(p);
  let s = max(params.dotSize / params.scale, 1.0); // Tupferabstand (volle Auflösung)
  let spacing = s * mix(1.3, 0.75, params.density / 100.0);
  let base = vec2i(floor(cp / spacing));
  var col = params.ground;
  var top = -1.0;
  for (var layer = 0u; layer < 2u; layer++) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        let cell = base + vec2i(dx, dy);
        let jitter = vec2f(rand_cell(cell, params.seed, 1u + layer * 5u), rand_cell(cell, params.seed, 2u + layer * 5u));
        let center = (vec2f(cell) + 0.15 + 0.7 * jitter + f32(layer) * 0.5) * spacing;
        // Strichform: Ellipse, zufällig gedreht (leicht ausgerichtet)
        let ang = rand_cell(cell, params.seed, 3u + layer * 5u) * 3.14159265;
        let e = params.elongation / 100.0;
        let ax = vec2f(cos(ang), sin(ang));
        let d = cp - center;
        let u = dot(d, ax) / (1.0 + e * 1.2);
        let w = dot(d, vec2f(-ax.y, ax.x)) / (1.0 - e * 0.45);
        let r = s * 0.5 * (0.8 + 0.4 * rand_cell(cell, params.seed, 4u + layer * 5u));
        let dist = sqrt(u * u + w * w);
        let cover = 1.0 - smoothstep(r - 0.75, r + 0.75, dist);
        if (cover <= 0.0) { continue; }
        let depth = rand_cell(cell, params.seed, 9u + layer);
        if (depth > top) {
          col = mix(col, dot_color(center, cell, layer), cover);
          if (cover > 0.5) { top = depth; }
        }
      }
    }
  }
  return premultiply(vec4f(col, load_src(p).a));
}
