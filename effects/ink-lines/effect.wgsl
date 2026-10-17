// Tusche-Linien (XDoG): luma → Gauß σ und 1,6σ → D = Fläche + p·(G1 − G2) → entlang der Kantentangente
// geglättet (Flow) → weiche Schwelle (tanh) → Tusche auf Papier bzw. über dem Bild.

@compute @workgroup_size(8, 8)
fn luma(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  let l = linear_to_srgb(vec3f(luminance(c.rgb))).x;
  // transparente Bereiche als Papier (hell)
  textureStore(dst, id.xy, vec4f(mix(1.0, l, c.a)));
}

// src = G1, src_b = G2 → D (r)
@compute @workgroup_size(8, 8)
fn dog(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let pk = 5.0 + params.detail * 0.35;
  let g1 = load_src(p).r;
  let g2 = textureLoad(src_b, p, 0).r;
  // XDoG: D = G1 + p·(G1 − G2); „Flächen“ mischt den Helligkeitsanteil ein (0 = nur Linien auf Weiß)
  let d = mix(1.0, g1, params.fill / 100.0) + pk * (g1 - g2);
  textureStore(dst, id.xy, vec4f(d));
}

// Glättung von D entlang der Kantentangente (Linienintegral, Gauß-gewichtet). v0.x = halbe Länge in Render-px
@compute @workgroup_size(8, 8)
fn flow_smooth(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let half = pass_data.v0.x;
  if (half < 0.5) {
    textureStore(dst, id.xy, load_src(p));
    return;
  }
  var sum = load_src(p).r;
  var wsum = 1.0;
  let sigma = max(half / 2.0, 0.5);
  // Weg in Leinwand-Koordinaten (kachelgenau), Index nur für das Nachschlagen auf die Kachel bezogen
  let q0 = canvas_px(p);
  let isize = src_size();
  for (var dir = -1.0; dir <= 1.0; dir += 2.0) {
    var q = q0;
    var t = edge_tangent(p) * dir;
    let steps = i32(ceil(half));
    for (var i = 1; i <= steps; i++) {
      q += t;
      let qi = vec2i(floor(q)) - vec2i(params.origin);
      if (any(qi < vec2i(0)) || any(qi >= isize)) { break; }
      var tn = edge_tangent(qi);
      if (dot(tn, t) < 0.0) { tn = -tn; }
      t = tn;
      let w = exp(-0.5 * f32(i * i) / (sigma * sigma));
      sum += w * sample_src_canvas(q).r;
      wsum += w;
    }
  }
  textureStore(dst, id.xy, vec4f(sum / wsum));
}

@compute @workgroup_size(8, 8)
fn ink(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let d = textureLoad(src_b, p, 0).r;
  let rough = (rand_noise(canvas_pos(p), max(params.thickness / params.scale, 0.5) * 3.0, params.seed) - 0.5) *
    params.roughness / 100.0 * 0.25;
  let eps = 0.3 + 0.6 * params.threshold / 100.0 + rough;
  let phi = 5.0 + 200.0 * pow(1.0 - params.softness / 100.0, 2.0);
  let t = select(1.0 + tanh(phi * (d - eps)), 1.0, d >= eps);
  let ink_amount = clamp(1.0 - t, 0.0, 1.0);
  let c = unpremultiply(load_src(p));
  var out: vec3f;
  var a = c.a;
  if (params.mode == 0u) {
    out = mix(params.paperColor, params.lineColor, ink_amount);
    a = max(c.a, ink_amount);
  } else {
    out = c.rgb * mix(vec3f(1.0), params.lineColor, ink_amount);
  }
  textureStore(dst, id.xy, premultiply(vec4f(out, a)));
}
