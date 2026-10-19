// Linolschnitt (Spec „Effekte“ 5.2): geglättete Helligkeit → Schatten = volle Farbe, Lichter = Papier, dazwischen
// Schnittlinien quer zur Bildrichtung (Richtungsfeld oder fester Winkel), deren Breite dem Tonwert folgt. Konturen aus
// der Kantenkarte bleiben als Farbe stehen; Druckkorn lässt Papier durchscheinen. Muster ortsfest auf der Leinwand.

@compute @workgroup_size(8, 8)
fn luma(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  let l = linear_to_srgb(vec3f(luminance(c.rgb))).x;
  textureStore(dst, id.xy, vec4f(mix(1.0, l, c.a)));
}

/** Abstand zur Linienmitte einer Streifenschar quer zum Winkel a: 0 = Mitte, 1 = zwischen den Linien */
fn stripe(cp: vec2f, a: f32, spacing: f32, wobble: f32) -> f32 {
  let nrm = vec2f(-sin(a), cos(a));
  let s = dot(cp, nrm) / spacing + wobble;
  return abs(fract(s) - 0.5) * 2.0;
}

// src = Quelle, src_b = geglättete Helligkeit
@compute @workgroup_size(8, 8)
fn cut(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let a = load_src(p).a;
  let t = textureLoad(src_b, p, 0).r;
  let cp = canvas_pos(p);
  let spacing = max(params.spacing / params.scale, 1.0); // Leinwand-px
  let wobble = (rand_noise(cp, spacing * 6.0, params.seed) - 0.5) * params.roughness / 100.0 * 1.2;
  // Richtung: Streifenscharen in festen Winkeln (alle 30°) sind über die ganze Leinwand stimmig; je Pixel werden die
  // zwei der Bildrichtung nächsten Scharen gemischt (ein Streifenfeld direkt entlang des Richtungsfelds bildet Moiré)
  let step = 0.52359878; // π/6
  var ang = params.angle;
  var wmix = 0.0;
  if (params.direction == 0u) {
    let tg = flow_tangent(p);
    ang = atan2(tg.y, tg.x);
  }
  let q = ang / step;
  var a0 = ang;
  if (params.direction == 0u) {
    a0 = floor(q) * step;
    wmix = smoothstep(0.3, 0.7, fract(q));
  }
  // Tonwert relativ zum Schwellwert: dunkel = Farbe, hell = Papier, Mitteltöne bekommen Schnitte
  let th = params.threshold / 100.0;
  let mid = max(params.midtones / 100.0 * 0.5, 0.01);
  let k = clamp((t - (th - mid)) / (2.0 * mid), 0.0, 1.0); // 0 = volle Farbe … 1 = Papier
  // Schnittbreite wächst mit der Helligkeit; Kantenbreite ≈ 1 Render-px
  let aa = clamp(params.scale / max(params.spacing, 1e-3) * 2.0, 0.02, 0.5);
  let ink0 = smoothstep(k - aa, k + aa, stripe(cp, a0, spacing, wobble));
  let ink1 = smoothstep(k - aa, k + aa, stripe(cp, a0 + step, spacing, wobble));
  var ink = mix(ink0, ink1, wmix);
  ink = select(ink, 1.0, k <= 0.0);
  ink = select(ink, 0.0, k >= 1.0);
  // Konturen
  let e = edge_strength(p);
  ink = max(ink, smoothstep(0.25, 0.6, e) * params.outline / 100.0);
  // Druckkorn: Papier scheint fleckig durch
  let g = rand_noise(cp, 2.0, params.seed + 7u) * 0.6 + rand_at(cp, params.seed, 3u) * 0.4;
  ink *= 1.0 - smoothstep(1.0 - params.grain / 100.0 * 0.45, 1.0, g);
  let col = mix(params.paper, params.ink, ink);
  textureStore(dst, id.xy, vec4f(col * a, a));
}
