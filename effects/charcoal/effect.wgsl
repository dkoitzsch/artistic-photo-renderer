// Kohle & Rötel: Ton = Helligkeit des Eingangs, entlang des Richtungsfelds verwischt (gemittelt über eine Stromlinie).
// Das Material haftet auf den Erhebungen eines prozeduralen Papiers (Körnung) – mittlere Töne werden körnig, dunkle
// decken. Dazu Striche (gemitteltes Rauschen entlang der Formen) und betonte Kanten. Kachelgenau.

fn pigment() -> vec3f {
  switch params.medium {
    case 1u: { return srgb_to_linear(vec3f(0.62, 0.27, 0.17)); }
    case 2u: { return srgb_to_linear(vec3f(0.42, 0.28, 0.17)); }
    case 3u: { return srgb_to_linear(vec3f(0.27, 0.28, 0.3)); }
    default: { return srgb_to_linear(vec3f(0.1, 0.095, 0.1)); }
  }
}

fn lum_at(x: vec2f) -> f32 {
  let c = unpremultiply(sample_src_canvas(x * params.scale));
  return luminance(clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0)));
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_pos(p);
  // verwischter Ton und Strichrauschen entlang der Stromlinie (beide Richtungen)
  let steps = 8;
  let len = max(params.smudge / params.scale, 0.5);
  let slen = max(params.grainSize * 12.0, len) ;
  var lsum = 0.0;
  var nsum = 0.0;
  var wsum = 0.0;
  for (var dir = -1.0; dir <= 1.0; dir += 2.0) {
    var x = cp;
    var prev = vec2f(0.0);
    for (var i = 0; i < steps; i++) {
      var t = flow_tangent_at(x * params.scale - params.origin);
      if (i > 0 && dot(t, prev) < 0.0) { t = -t; }
      if (i == 0 && dir < 0.0) { t = -t; }
      prev = t;
      let w = 1.0 - f32(i) / f32(steps);
      lsum += lum_at(cp + (x - cp) * len / slen) * w;
      nsum += rand_noise(x, params.grainSize * 1.5, params.seed + 7u) * w;
      wsum += w;
      x += t * slen / f32(steps);
    }
  }
  var l = lsum / wsum;
  let k = params.contrast / 100.0;
  l = clamp((l - 0.5) * (1.0 + k) + 0.5, 0.0, 1.0);
  var dark = 1.0 - l;
  // Striche: helle/dunkle Streifen entlang der Formen modulieren mittlere Töne
  let stroke = nsum / wsum - 0.5;
  dark = clamp(dark + stroke * params.strokes / 100.0 * 0.9 * (1.0 - abs(dark * 2.0 - 1.0) * 0.5), 0.0, 1.0);
  // Papier: Erhebungen (fein + grob); Material haftet zuerst auf den Spitzen
  let g = params.grainSize;
  let paper_h = 0.65 * rand_fbm(cp, g * 2.0, 3u, params.seed) + 0.35 * rand_noise(cp, g * 9.0, params.seed + 3u);
  let gr = params.grain / 100.0;
  let cover = smoothstep(paper_h - 0.5 * (1.0 - gr) - 0.02, paper_h + 0.05, dark * (1.0 + 0.35 * gr));
  var amount = mix(dark, cover, gr);
  // Kanten
  let e = smoothstep(0.06, 0.4, edge_strength(p)) * params.edges / 100.0;
  amount = clamp(max(amount, e * (0.6 + 0.4 * rand_noise(cp, g * 3.0, params.seed + 11u))), 0.0, 1.0);
  // Papierstruktur leicht sichtbar, Pigment multiplikativ (dunkler bei mehrfachem Auftrag)
  let paper = params.paper * (0.94 + 0.06 * paper_h);
  let rgb = paper * mix(vec3f(1.0), pigment() / max(params.paper, vec3f(0.05)), amount);
  return premultiply(vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), load_src(p).a));
}
