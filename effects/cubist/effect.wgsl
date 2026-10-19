// Kubistische Mehrperspektive: Die Leinwand wird in Fragmente zerlegt (Voronoi-Splitter oder gedrehte Rechtecke wie
// Hockneys Foto-Joiner). Jedes Fragment zeigt das Bild aus einem von N Blickwinkeln: Rückwärts-Verschiebung um
// Versatz · (Fokus − Tiefe), nahe Bereiche verschieben sich stärker (zwei Iterationen für die Tiefe am Zielort).
// Was außerhalb des Bildes liegt, ist Lücke (Umgebung, Farbfläche oder offen). Alles in Leinwand-px (kachelgenau).

const TAU: f32 = 6.2831853;

fn depth_canvas(q: vec2f) -> f32 {
  let uv = (q - params.origin) / vec2f(src_size());
  return textureSampleLevel(depth_tex, linear_sampler, uv, 0.0).r;
}

/** Fragment an einer Leinwandposition (Render-px): x = Zufall der Perspektive, y = Rand-Abstand (px), zw = Drehzentrum */
struct Frag {
  id: vec4f,     // r1, r2, r3, inside (1 = innerhalb eines Fragments)
  center: vec2f, // Mittelpunkt (Render-px)
  edge: f32,     // Abstand zum Fragmentrand (Render-px)
}

fn shards(q: vec2f, cell: f32) -> Frag {
  let g = q / cell;
  let base = vec2i(floor(g));
  var d1 = 1e9;
  var d2 = 1e9;
  var best = vec2i(0);
  var bestPt = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = base + vec2i(x, y);
      let pt = vec2f(c) + 0.1 + 0.8 * vec2f(rand_cell(c, params.seed, 0u), rand_cell(c, params.seed, 1u));
      let d = distance(g, pt);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        best = c;
        bestPt = pt;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  var f: Frag;
  f.id = vec4f(rand_cell(best, params.seed, 2u), rand_cell(best, params.seed, 3u), rand_cell(best, params.seed, 4u), 1.0);
  f.center = bestPt * cell;
  f.edge = (d2 - d1) * 0.5 * cell;
  return f;
}

fn joiner(q: vec2f, cell: f32) -> Frag {
  let g = q / cell;
  let base = vec2i(floor(g));
  var f: Frag;
  f.id = vec4f(0.0);
  f.edge = 0.0;
  var bestZ = -1.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = base + vec2i(x, y);
      let ctr = (vec2f(c) + 0.3 + 0.4 * vec2f(rand_cell(c, params.seed, 0u), rand_cell(c, params.seed, 1u))) * cell;
      let ang = (rand_cell(c, params.seed, 5u) - 0.5) * 2.0 * params.tilt * 0.0174533;
      let half = cell * vec2f(0.62 + 0.2 * rand_cell(c, params.seed, 6u), 0.55 + 0.2 * rand_cell(c, params.seed, 7u));
      let d = q - ctr;
      let local = vec2f(cos(ang) * d.x + sin(ang) * d.y, -sin(ang) * d.x + cos(ang) * d.y);
      let inside = half - abs(local);
      let z = rand_cell(c, params.seed, 8u);
      if (inside.x > 0.0 && inside.y > 0.0 && z > bestZ) {
        bestZ = z;
        f.id = vec4f(rand_cell(c, params.seed, 2u), rand_cell(c, params.seed, 3u), ang, 1.0);
        f.center = ctr;
        f.edge = min(inside.x, inside.y);
      }
    }
  }
  return f;
}

// src = Bild, src_b = geglättetes Bild
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let q = canvas_px(p);
  let cell = max(params.fragment, 4.0);
  var f: Frag;
  if (params.shape == 0u) { f = shards(q, cell); } else { f = joiner(q, cell); }
  let c0 = load_src(p);
  let a0 = c0.a;
  var gap = f.id.w < 0.5;
  var col = vec4f(0.0);
  if (!gap) {
    // Blickwinkel dieses Fragments
    let k = floor(f.id.x * f32(params.views));
    let phase = rand_cell(vec2i(7, 3), params.seed, 9u) * TAU;
    let dir = vec2f(cos(phase + TAU * k / f32(params.views)), sin(phase + TAU * k / f32(params.views)));
    let off = dir * params.strength;
    // Joiner: Foto leicht gedreht um seinen Mittelpunkt
    var src_q = q;
    if (params.shape == 1u) {
      let a = f.id.z * 0.5;
      let d = q - f.center;
      src_q = f.center + vec2f(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
    }
    // Rückwärts-Verschiebung nach Tiefe (nah = 0 verschiebt am stärksten)
    var s = src_q;
    for (var i = 0; i < 2; i++) {
      let d = depth_canvas(s);
      s = src_q + off * (0.5 - d);
    }
    let canvas = params.canvas_size;
    if (any(s < vec2f(0.0)) || any(s > canvas)) {
      gap = true;
    } else {
      col = sample_src_canvas(s);
      // jedes Fragment leicht anders belichtet (wie einzelne Fotos)
      let expo = 0.9 + 0.2 * f.id.y;
      col = vec4f(col.rgb * expo, col.a);
    }
  }
  if (gap) {
    if (params.fill == 0u) { col = textureLoad(src_b, p, 0); }
    else if (params.fill == 1u) { col = vec4f(params.fillColor * a0, a0); }
    else { col = vec4f(0.0); }
  }
  // Fugen: dunkle Linie an Splitterrändern bzw. weißer Fotorand mit Schatten (Joiner)
  let lw = max(1.0, params.fragment * 0.012);
  let lines = params.lines / 100.0;
  if (!gap) {
    if (params.shape == 0u) {
      let l = 1.0 - smoothstep(lw * 0.5, lw * 1.5, f.edge);
      col = vec4f(mix(col.rgb, col.rgb * 0.2, l * lines), col.a);
    } else {
      let border = 1.0 - smoothstep(lw * 1.5, lw * 2.5, f.edge);
      col = vec4f(mix(col.rgb, vec3f(0.96) * col.a, border * lines), col.a);
      let shade = 1.0 - smoothstep(0.0, lw * 6.0, f.edge);
      col = vec4f(col.rgb * (1.0 - shade * 0.25 * lines), col.a);
    }
  }
  textureStore(dst, id.xy, col);
}
