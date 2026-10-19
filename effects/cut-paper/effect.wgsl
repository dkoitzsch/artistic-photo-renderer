// Papierschnitt (Spec „Effekte“ 5.5): geglättete Helligkeit (+ raue Kante aus Rauschen) → Lage 0 … N−1 (hell = oben).
// Schlagschatten: Ein Pixel liegt im Schatten, wenn in Richtung Licht eine höhere Lage innerhalb der Schattenlänge
// liegt (Abtastung in Leinwand-Koordinaten, kachelgenau). Farbe aus Palette oder aus dem geglätteten Bild,
// angepasst an die Helligkeit der Lage; Papierfaser als feines Rauschen.

const SHADOW_STEPS: i32 = 14;

// rgb = Farbe (nicht vormultipliziert), a = wahrgenommene Helligkeit
@compute @workgroup_size(8, 8)
fn prep(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  let l = linear_to_srgb(vec3f(luminance(c.rgb))).x;
  textureStore(dst, id.xy, vec4f(c.rgb, mix(1.0, l, c.a)));
}

/** Lage an einer Leinwandposition (Render-px), Kante mit Rauschen aufgeraut */
fn layer_at(q: vec2f) -> f32 {
  let n = f32(params.layers);
  let l = textureSampleLevel(src_b, linear_sampler, (q - params.origin) / vec2f(src_size()), 0.0).a;
  let cp = q / params.scale;
  let rough = (rand_fbm(cp, 18.0, 3u, params.seed) - 0.5) * params.roughness / 100.0 * 0.6 / n;
  return min(floor(clamp(l + rough, 0.0, 0.9999) * n), n - 1.0);
}

@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let a = load_src(p).a;
  let q0 = canvas_px(p);
  let n = f32(params.layers);
  let k = layer_at(q0);
  // Schatten: höhere Lage in Richtung Licht (entgegen der Schattenrichtung)
  let toLight = -vec2f(cos(params.shadowAngle), sin(params.shadowAngle));
  var shade = 0.0;
  if (params.shadowLength > 0.0) {
    for (var i = 1; i <= SHADOW_STEPS; i++) {
      let t = f32(i) / f32(SHADOW_STEPS);
      let kk = layer_at(q0 + toLight * t * params.shadowLength);
      if (kk > k) {
        // je mehr Lagen dazwischen, desto dunkler; zum Schattenende weicher
        shade = max(shade, (1.0 - t * 0.85) * min(1.0, (kk - k) * 0.6 + 0.4));
      }
    }
  }
  // Farbe der Lage
  var col: vec3f;
  let level = (k + 0.5) / n;
  if (params.colorMode == 1u) {
    let cnt = max(min(params.palette_count, 16u), 1u);
    let idx = min(u32(floor(level * f32(cnt))), cnt - 1u);
    col = params.palette[idx].rgb;
  } else {
    let img = textureLoad(src_b, p, 0).rgb;
    let lab = oklab_from_linear(max(img, vec3f(0.0)));
    // Helligkeit auf die Mitte der Lage setzen, Farbe etwas kräftiger (Papier ist gesättigt)
    let target_l = srgb_to_linear(vec3f(level)).x;
    let lab2 = vec3f(oklab_from_linear(vec3f(target_l)).x, lab.yz * 1.15);
    col = max(linear_from_oklab(lab2), vec3f(0.0));
  }
  // Papierfaser und leichte Wölbung (heller zur Lichtseite)
  let cp = q0 / params.scale;
  let fiber = (rand_fbm(cp * vec2f(1.0, 0.25), 3.0, 2u, params.seed + 11u) - 0.5) * params.fiber / 100.0 * 0.12;
  col *= 1.0 + fiber;
  col *= 1.0 - shade * params.shadowStrength / 100.0 * 0.75;
  textureStore(dst, id.xy, vec4f(max(col, vec3f(0.0)) * a, a));
}
