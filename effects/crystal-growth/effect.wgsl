// Eisblumen: zelluläres Spitzenwachstum auf einem festen Raster über der Leinwand. r = Kristall (0/1), g = Zeitpunkt des
// Anwachsens (0…1). Eine leere Zelle wächst an, wenn genau eine Nachbarzelle Kristall ist (Spitze) oder – mit der
// Verzweigungswahrscheinlichkeit – zwei; je Schritt zufällig mit der Wachstumsrate. Daraus entstehen verästelte,
// farnartige Strukturen (ähnlich diffusionsbegrenzter Aggregation).

@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let ps = vec2i(uv * vec2f(src_size()));
  var p = 0.0;
  if (params.seeds == 0u) { p = smoothstep(0.25, 0.7, edge_strength(ps)); }
  if (params.seeds == 1u) { p = smoothstep(0.55, 0.15, load_luminance(ps)); }
  if (params.seeds == 2u) { p = 0.3; }
  let r = rand_cell(vec2i(id.xy), params.seed, 1u);
  let seed = select(0.0, 1.0, r < p * params.density / 100.0 * 0.01);
  textureStore(dst, id.xy, vec4f(seed, 0.0, 2.0, 1.0));
}

fn state(p: vec2i, size: vec2i) -> vec4f {
  if (any(p < vec2i(0)) || any(p >= size)) { return vec4f(0.0); }
  return textureLoad(src, p, 0);
}

// Zustand: r = Kristall, g = Zeitpunkt, b = Wuchsrichtung (Winkel / 2π, 2 = Keim ohne Richtung)
// pass_data.v0.x = Schritt, v0.y = Anzahl Schritte
@compute @workgroup_size(8, 8)
fn grow(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(dst));
  let p = vec2i(id.xy);
  if (p.x >= size.x || p.y >= size.y) { return; }
  let c = textureLoad(src, p, 0);
  if (c.r > 0.5) {
    textureStore(dst, id.xy, c);
    return;
  }
  // Nachbarn: 3 × 3 (Kontakt) und 5 × 5 (Abstand zu anderen Ästen)
  var n = 0.0;
  var far = 0.0;
  var parent = vec4f(0.0);
  var pdir = vec2f(0.0);
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let v = state(p + vec2i(dx, dy), size);
      far += v.r;
      if (abs(dx) <= 1 && abs(dy) <= 1 && v.r > 0.5) {
        n += 1.0;
        parent = v;
        pdir = -vec2f(f32(dx), f32(dy));
      }
    }
  }
  let step = u32(pass_data.v0.x);
  let r = rand_cell(p, params.seed + step * 7919u, 2u);
  let rate = params.rate / 100.0;
  var grows = false;
  let d = normalize(pdir);
  if (n > 0.5 && n < 1.5 && far < 4.5) {
    if (parent.b > 1.5) {
      grows = r < rate; // Keim: in jede Richtung
    } else {
      let a = parent.b * 6.2831853;
      let along = dot(d, vec2f(cos(a), sin(a)));
      if (along > 0.86) { grows = r < rate; } // geradeaus (± 30°)
      else if (along > 0.3 && along < 0.75 && far < 4.5) { grows = r < rate * params.branching / 100.0 * 1.2; } // ≈ 45–60° Ast
    }
  }
  if (grows) {
    var ang = atan2(d.y, d.x);
    // leichte Krümmung (ortsfest), damit Äste nicht starr wirken
    ang += (rand_cell(p, params.seed, 5u) - 0.5) * 0.25;
    let b = fract(ang / 6.2831853 + 1.0);
    textureStore(dst, id.xy, vec4f(1.0, pass_data.v0.x / max(pass_data.v0.y, 1.0), b, 1.0));
  } else {
    textureStore(dst, id.xy, c);
  }
}

// src = Zustand, src_b = geglätteter Zustand → r Kristall, g Zeit, b Lichthof
@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = textureLoad(src, vec2i(id.xy), 0);
  let g = textureLoad(src_b, vec2i(id.xy), 0).r;
  textureStore(dst, id.xy, vec4f(c.r, c.g, g, 1.0));
}

// src = Bild, src_b = gepackter Zustand → Ausgabe in voller Auflösung
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let uv = canvas_px(p) / params.canvas_size;
  let s = textureSampleLevel(src_b, linear_sampler, uv, 0.0);
  let c = load_src(p);
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  // Frost: kühler, heller Schleier, dichter in der Nähe der Kristalle
  let frost = params.frost / 100.0 * (0.35 + 0.65 * clamp(s.b * 3.0, 0.0, 1.0));
  let cold = mix(rgb, vec3f(luminance(rgb)) * vec3f(0.85, 0.95, 1.1), 0.5);
  var out = mix(rgb, mix(cold, params.color, 0.35), frost);
  // Kristalllinien: scharf, ältere (früh gewachsene) heller, mit Glitzern
  let line = smoothstep(0.3, 0.7, s.r);
  let spark = rand_at(canvas_pos(p), params.seed, 3u);
  let bright = mix(0.85, 1.15, 1.0 - s.g) * (1.0 + 0.25 * step(0.97, spark));
  out = mix(out, params.color * bright, line * 0.9);
  // Lichthof
  out += params.color * clamp(s.b * 1.5, 0.0, 1.0) * 0.15;
  textureStore(dst, id.xy, vec4f(out * c.a, c.a));
}
