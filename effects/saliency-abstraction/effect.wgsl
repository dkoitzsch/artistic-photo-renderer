// Abstraktion nach Aufmerksamkeit: Wichtigkeit = max(Salienz, Gesichter, ggf. Fokuskarte); Abstraktionsgrad
// a = Stärke · (1 − weich begrenzte Wichtigkeit). Drei Durchgänge mischen stufenweise Original → Unschärfe ¼, ½, 1
// (pass_data.v0.x = Stufe 0…2). „Vereinfachen“ setzt im letzten Durchgang die Farben in Oklab auf Stufen.

fn abstraction(p: vec2i) -> f32 {
  var imp = max(load_saliency(p), load_faces(p));
  if (params.useFocus != 0u && has_focus()) { imp = max(imp, load_focus(p)); }
  let soft = max(params.softness / 100.0, 0.02);
  let keep = smoothstep(0.5 - soft * 0.5, 0.5 + soft * 0.5, imp);
  return params.amount / 100.0 * (1.0 - keep);
}

fn posterize(c: vec4f, a: f32) -> vec4f {
  if (c.a <= 0.0) { return c; }
  let rgb = c.rgb / c.a;
  let lab = oklab_from_linear(max(rgb, vec3f(0.0)));
  let n = f32(params.levels);
  let L = floor(lab.x * n + 0.5) / n;
  // Buntheit leicht vereinheitlichen, Farbton behalten
  let ab = lab.yz * (1.0 + 0.15 * a);
  let q = linear_from_oklab(vec3f(mix(lab.x, L, a), ab));
  return vec4f(max(q, vec3f(0.0)) * c.a, c.a);
}

@compute @workgroup_size(8, 8)
fn stage(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let k = pass_data.v0.x;
  let a = abstraction(p) * 3.0; // 0…3 Stufen
  let prev = load_src(p);
  let next = textureLoad(src_b, p, 0);
  // Anteil dieser Stufe: 0 unterhalb, linear innerhalb, 1 oberhalb
  let t = clamp(a - k, 0.0, 1.0);
  var c = mix(prev, next, t);
  if (k > 1.5 && params.mode == 0u) { c = posterize(c, clamp(a / 3.0, 0.0, 1.0)); }
  textureStore(dst, id.xy, c);
}
