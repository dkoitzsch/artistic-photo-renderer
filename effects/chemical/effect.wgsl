// Chemische Prozesse: Startbereiche (Kanten, Dunkles, Nahes oder überall) werden mit der Ausbreitung geglättet; der
// Fortschritt verschiebt eine unregelmäßige Front (Rauschen in Leinwand-px) durch dieses Feld. Im erfassten Bereich:
// Rost (Orange-Braun, Lochfraß, Krusten), Bleiche (aufhellen, entsättigen, Ränder an der Front) oder Solarisation
// (Umkehr der Lichter, Mackie-Linien an Kanten).

// r = Startwert 0…1
@compute @workgroup_size(8, 8)
fn start(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  // überall: weiche Flecken (Wasserflecken, Stockflecken) als Ausgangspunkte
  var s = smoothstep(0.42, 0.6, rand_fbm(canvas_pos(p), max(params.spread / params.scale * 2.0, 8.0), 3u, params.seed + 17u));
  if (params.start == 0u) { s = smoothstep(0.15, 0.5, edge_strength(p)); }
  if (params.start == 1u) { s = smoothstep(0.45, 0.1, load_luminance(p)); }
  if (params.start == 2u) { s = smoothstep(0.5, 0.15, load_depth(p)); }
  textureStore(dst, id.xy, vec4f(s, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn apply(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let cp = canvas_pos(p);
  let c = load_src(p);
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  // Ausbreitungsfeld 0…1 (verstärkt, damit dünne Startlinien weit genug reichen)
  let field = clamp(textureLoad(src_b, p, 0).r * 3.0, 0.0, 1.0);
  let spreadPx = params.spread / params.scale;
  let noise = rand_fbm(cp, max(spreadPx * 0.5, 4.0), 4u, params.seed) - 0.5;
  let level = field + noise * params.irregular / 100.0 * 0.8;
  let thr = 1.0 - params.progress / 100.0;
  let a = smoothstep(thr - 0.06, thr + 0.06, level);
  let front = smoothstep(0.12, 0.0, abs(level - thr)) * step(0.001, params.progress);
  let tex = params.texture / 100.0;
  var out = rgb;
  if (params.process == 0u) {
    // Rost: Farbe von Orange bis Dunkelbraun, Lochfraß und Krusten
    let n1 = rand_fbm(cp, 6.0, 3u, params.seed + 3u);
    let n2 = rand_fbm(cp, 28.0, 3u, params.seed + 5u);
    let rustLight = srgb_to_linear(vec3f(0.78, 0.42, 0.16));
    let rustDark = srgb_to_linear(vec3f(0.30, 0.13, 0.06));
    var rust = mix(rustDark, rustLight, smoothstep(0.3, 0.7, n2));
    rust *= 0.75 + 0.5 * mix(0.5, n1, tex);
    // Lochfraß: dunkle Punkte
    rust *= 1.0 - 0.6 * smoothstep(0.82, 0.9, rand_noise(cp, 3.0, params.seed + 9u)) * tex;
    // Bildstruktur bleibt durchscheinend
    let l = luminance(rgb);
    let tinted = rust * (0.55 + 0.9 * l);
    out = mix(rgb, tinted, a * 0.92);
    out *= 1.0 - front * 0.35;
  } else if (params.process == 1u) {
    // Bleiche: heller, entsättigt, leicht gelblich; an der Front ein Gezeitenrand
    let pale = mix(vec3f(luminance(rgb)), rgb, 0.25);
    let bleached = mix(pale, srgb_to_linear(vec3f(0.97, 0.94, 0.85)), 0.55 + 0.25 * rand_fbm(cp, 20.0, 3u, params.seed) * tex);
    out = mix(rgb, bleached, a);
    out = mix(out, out * srgb_to_linear(vec3f(0.78, 0.66, 0.45)), front * 0.6);
  } else {
    // Solarisation: Lichter kehren sich um (Sabattier), Mackie-Linien an Kanten
    let s = linear_to_srgb(rgb);
    let inv = select(s, 1.0 - s, s > vec3f(0.5)) * vec3f(1.0) + select(vec3f(0.0), vec3f(0.08), s > vec3f(0.5));
    var sol = srgb_to_linear(clamp(inv * 1.15, vec3f(0.0), vec3f(1.0)));
    let e = edge_strength(p);
    sol = mix(sol, vec3f(0.02), smoothstep(0.35, 0.7, e) * 0.8);
    out = mix(rgb, sol, a);
  }
  textureStore(dst, id.xy, vec4f(max(out, vec3f(0.0)) * c.a, c.a));
}
