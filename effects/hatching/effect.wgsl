// Schraffur: Ton aus dem Eingang (leicht gemittelt), je Lage eine Schwelle; dunklere Stellen bekommen mehr Lagen und
// breitere Linien. Gerade Linien: Abstandsfunktion zu parallelen Geraden in Leinwand-Koordinaten (volle Auflösung),
// mit Wackeln und Lücken aus ortsfestem Rauschen. Entlang der Formen: Line Integral Convolution eines Strichrauschens
// entlang des Richtungsfelds (jede zweite Lage quer dazu). Alles kachelgenau.

const PI = 3.14159265;

fn tone_at(p: vec2i) -> f32 {
  let q = canvas_px(p);
  let r = max(params.spacing * 0.5, 1.0);
  var sum = 0.0;
  for (var i = 0; i < 5; i++) {
    let o = select(vec2f(0.0), vec2f(cos(f32(i) * 1.2566), sin(f32(i) * 1.2566)) * r, i > 0);
    let c = unpremultiply(sample_src_canvas(q + o));
    sum += luminance(clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0)));
  }
  let l = sum / 5.0 + params.tone / 200.0;
  return clamp(1.0 - l, 0.0, 1.0);
}

/** Tinte einer geraden Linienlage in Richtung a (Radiant) bei Strichstärke w (volle Auflösung). */
fn straight_layer(cp: vec2f, a: f32, w: f32, k: u32) -> f32 {
  let s = params.spacing / params.scale;
  let d = vec2f(cos(a), sin(a));
  let n = vec2f(-d.y, d.x);
  let along = dot(cp, d);
  var across = dot(cp, n) / s;
  // Handschrift: Linie wellt sich leicht, Linien sind gegeneinander versetzt
  let j = params.jitter / 100.0;
  let line_id = floor(across + 0.5);
  across += (rand_noise(vec2f(along, line_id * 37.0), s * 6.0, params.seed + k) - 0.5) * 0.35 * j;
  let dist = abs(fract(across + 0.5) - 0.5) * s;
  var ink = 1.0 - smoothstep(w * 0.5 - 0.6, w * 0.5 + 0.6, dist);
  // Lücken: einzelne Abschnitte setzen aus
  let gap = rand_noise(vec2f(along / (s * 8.0), line_id), 1.0, params.seed + 101u + k);
  ink *= mix(1.0, smoothstep(0.15, 0.3, gap), j);
  return ink;
}

/** Strichrauschen entlang des Richtungsfelds (LIC), Wert 0..1; quer = jede zweite Lage um 90° gedreht. */
fn flow_layer(p: vec2i, quer: bool, k: u32) -> f32 {
  let s = params.spacing / params.scale;
  let steps = 10;
  let len = params.strokeLength / params.scale;
  let h = len / f32(steps);
  var sum = 0.0;
  var wsum = 0.0;
  for (var dir = -1.0; dir <= 1.0; dir += 2.0) {
    var x = canvas_pos(p);
    var prev = vec2f(0.0);
    for (var i = 0; i < steps; i++) {
      var t = flow_tangent_at(x * params.scale - params.origin);
      if (quer) { t = vec2f(-t.y, t.x); }
      if (i > 0 && dot(t, prev) < 0.0) { t = -t; }
      if (i == 0 && dir < 0.0) { t = -t; }
      prev = t;
      let w = 1.0 - f32(i) / f32(steps);
      sum += rand_noise(x, s * 0.7, params.seed + k) * w;
      wsum += w;
      x += t * h;
    }
  }
  return sum / max(wsum, 1e-6);
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_pos(p);
  let dark = tone_at(p);
  let n = params.layers;
  var ink = 0.0;
  let w0 = params.width / params.scale;
  for (var i = 0; i < 4; i++) {
    if (i >= n) { break; }
    let thr = (f32(i) + 0.5) / f32(n + 1);
    let amount = smoothstep(thr - 0.06, thr + 0.06, dark);
    if (amount <= 0.0) { continue; }
    let extra = clamp((dark - thr) / max(1.0 - thr, 1e-3), 0.0, 1.0);
    let w = w0 * mix(0.7, 1.5, extra);
    var layer = 0.0;
    if (params.followFlow != 0u) {
      let v = flow_layer(p, (i % 2) == 1, u32(i) * 13u);
      // gemitteltes Rauschen hat wenig Streuung: auf 0..1 strecken → Striche; Anteil der Tinte wächst mit dem Ton
      let f = clamp((v - 0.5) * 5.0 + 0.5, 0.0, 1.0);
      let q = 0.12 + 0.45 * extra;
      layer = 1.0 - smoothstep(q - 0.08, q + 0.08, f);
    } else {
      let a = params.angle + f32(i) * select(PI * 0.5, PI / f32(n), n > 2);
      layer = straight_layer(cp, a, w, u32(i) * 13u);
    }
    ink = max(ink, layer * amount);
  }
  // Kontur aus der Kantenkarte
  let e = smoothstep(0.08, 0.35, edge_strength(p)) * params.outline / 100.0;
  ink = max(ink, e);
  let rgb = mix(params.paper, params.ink, ink);
  return premultiply(vec4f(rgb, load_src(p).a));
}
