// Erinnerung: Wichtigkeit = max(Salienz, Gesichter, ggf. Fokuskarte); Vergessen f = Grad · (1 − weich begrenzte
// Wichtigkeit), zum Bildrand hin etwas stärker. Verblassen: entsättigen, aufhellen zur Farbe des Vergessens;
// Verschwimmen: Unschärfe wächst mit f; Auflösen: Pixel driften (ortsfestes Rauschen) und verschwinden körnig im Papier.

fn forget_at(p: vec2i) -> f32 {
  var imp = max(load_saliency(p), load_faces(p));
  if (params.useFocus != 0u && has_focus()) { imp = max(imp, load_focus(p)); }
  let soft = max(params.softness / 100.0, 0.02);
  let keep = smoothstep(0.45 - soft * 0.4, 0.45 + soft * 0.4, imp);
  let uv = canvas_pos(p) / max(params.canvas_size / params.scale, vec2f(1.0));
  let vign = smoothstep(0.2, 0.75, length(uv - 0.5) * 1.4);
  return clamp(params.forget / 100.0 * (1.0 - keep) * (0.75 + 0.5 * vign), 0.0, 1.0);
}

// src = Unschärfe r/3, src_b = Unschärfe r → je Pixel passend gemischt (für „Verschwimmen“)
@compute @workgroup_size(8, 8)
fn blur_mix(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = forget_at(p);
  textureStore(dst, id.xy, mix(load_src(p), textureLoad(src_b, p, 0), smoothstep(0.3, 1.0, f)));
}

// src = Original, src_b = gemischte Unschärfe
@compute @workgroup_size(8, 8)
fn decay(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = forget_at(p);
  let cp = canvas_pos(p);
  let c = load_src(p);
  let a = c.a;
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  let b = textureLoad(src_b, p, 0);
  let brgb = select(vec3f(0.0), b.rgb / max(b.a, 1e-4), b.a > 0.0);
  var out = rgb;
  if (params.decay == 0u) {
    // Verblassen: Farbe weicht, Kontrast sinkt, Richtung Papier; leichte Unschärfe
    let soft = mix(rgb, brgb, f * 0.5);
    let gray = vec3f(luminance(soft));
    let washed = mix(soft, gray, f * 0.8);
    out = mix(washed, params.paper, f * 0.75);
  } else if (params.decay == 1u) {
    // Verschwimmen: Unschärfe wächst, etwas blasser
    let soft = mix(rgb, brgb, smoothstep(0.0, 0.4, f));
    out = mix(soft, params.paper, f * 0.25);
  } else {
    // Auflösen: Pixel driften (Richtung aus Rauschen) und verschwinden körnig
    let drift = vec2f(rand_noise(cp, 40.0, params.seed) - 0.5, rand_noise(cp, 40.0, params.seed + 3u) - 0.6);
    let q = canvas_px(p) + drift * params.radius * 2.0 * f;
    let moved = sample_src_canvas(q);
    let mrgb = select(vec3f(0.0), moved.rgb / moved.a, moved.a > 0.0);
    let grain = rand_at(cp, params.seed, 5u) * 0.6 + rand_noise(cp, 3.0, params.seed + 9u) * 0.4;
    let gone = smoothstep(1.05 - f, 1.2 - f, grain + f * 0.35);
    out = mix(mix(rgb, mrgb, smoothstep(0.1, 0.5, f)), params.paper, gone);
  }
  textureStore(dst, id.xy, vec4f(max(out, vec3f(0.0)) * a, a));
}
