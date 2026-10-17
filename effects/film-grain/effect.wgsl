// Filmkorn, Halation und Lichteinfall.
//   bright: helle Bereiche (weicher Schwellwert) für die Halation
//   combine: src_b = geweichzeichnete Lichter (bzw. src), Korn und Lichteinfall
// Korn und Lichteinfall hängen nur von der Leinwandposition und dem Seed ab (gleich in Vorschau und Export).

@compute @workgroup_size(8, 8)
fn bright(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  let l = linear_to_srgb(vec3f(luminance(c.rgb))).x;
  let t = params.halationThreshold / 100.0;
  let w = smoothstep(t - 0.08, t + 0.08, l);
  textureStore(dst, id.xy, vec4f(c.rgb * w * c.a, c.a * w));
}

fn leak_anchor() -> vec2f {
  let s = params.canvas_size / params.scale; // Leinwand in Original-px
  switch params.leakPosition {
    case 0u: { return vec2f(0.0, 0.0); }
    case 1u: { return vec2f(s.x, 0.0); }
    case 2u: { return vec2f(0.0, s.y); }
    case 3u: { return s; }
    case 4u: { return vec2f(0.0, s.y * 0.5); }
    default: { return vec2f(s.x, s.y * 0.5); }
  }
}

@compute @workgroup_size(8, 8)
fn combine(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let src_c = load_src(p);
  if (src_c.a <= 0.0) {
    textureStore(dst, id.xy, src_c);
    return;
  }
  var c = unpremultiply(src_c);
  let cp = canvas_pos(p);
  let seed = params.seed;

  // Halation: geweichzeichnete Lichter, getönt, addiert (linear)
  if (params.halation > 0.0) {
    let h = textureLoad(src_b, p, 0);
    c = vec4f(c.rgb + h.rgb * params.halationColor * (params.halation / 100.0) * 2.0, c.a);
  }

  // Lichteinfall: weicher Fleck vom Rand, mit fraktalem Rauschen moduliert, „Negativ multiplizieren“
  if (params.leaks > 0.0) {
    let diag = length(params.canvas_size / params.scale);
    let d = length(cp - leak_anchor()) / max(diag * params.leakSize / 100.0, 1.0);
    let n = rand_fbm(cp, diag * 0.12, 3u, seed + 101u);
    let glow = clamp(exp(-d * d * 2.5) * (0.55 + 0.9 * n) * params.leaks / 100.0, 0.0, 1.0);
    c = vec4f(1.0 - (1.0 - clamp(c.rgb, vec3f(0.0), vec3f(1.0))) * (1.0 - params.leakColor * glow), c.a);
  }

  // Korn in sRGB, stärker in den Mitteltönen; Zellgröße in Original-px
  if (params.amount > 0.0) {
    let cell = params.size / params.scale;
    var s = linear_to_srgb(clamp(c.rgb, vec3f(0.0), vec3f(1.0)));
    let l = luminance(s);
    let weight = 0.35 + 0.65 * 4.0 * l * (1.0 - l);
    let g = (rand_fbm(cp, cell, 2u, seed) - 0.5) * 2.0;
    let k = params.amount / 100.0 * 0.22 * weight;
    let col = vec3f(
      rand_fbm(cp, cell, 2u, seed + 11u),
      rand_fbm(cp, cell, 2u, seed + 23u),
      rand_fbm(cp, cell, 2u, seed + 37u),
    ) - 0.5;
    s = s + k * (g + col * 2.0 * params.colorGrain / 100.0);
    c = vec4f(srgb_to_linear(clamp(s, vec3f(0.0), vec3f(1.0))), c.a);
  }
  textureStore(dst, id.xy, premultiply(c));
}
