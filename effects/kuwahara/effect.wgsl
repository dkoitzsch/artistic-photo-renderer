// Anisotroper Kuwahara-Filter (Kyprianidis 2009) mit weich überlappenden Sektoren.
// Ellipse: lange Achse entlang der Kantentangente, Streckung nach der Kohärenz (Anisotropie A).
// Für jeden der 8 Sektoren Mittelwert und Varianz; Ausgabe = Σ αᵢ·mᵢ / Σ αᵢ mit αᵢ = 1 / (1 + σᵢ^q).
// Positionen in Leinwand-Koordinaten (sample_src_canvas) – kachelgenau.

const N: i32 = 8;
const SECTOR = array<vec2f, 8>(
  vec2f(1.0, 0.0), vec2f(0.7071068, 0.7071068), vec2f(0.0, 1.0), vec2f(-0.7071068, 0.7071068),
  vec2f(-1.0, 0.0), vec2f(-0.7071068, -0.7071068), vec2f(0.0, -1.0), vec2f(0.7071068, -0.7071068),
);

@compute @workgroup_size(8, 8)
fn kuwahara(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let r = max(params.radius, 0.5);
  let t = edge_tangent(p);
  let a_coh = edge_coherence(p);
  let alpha = mix(4.0, 0.3, params.anisotropy / 100.0);
  // Halbachsen der Ellipse (entlang / quer zur Kante)
  let ra = r * clamp((alpha + a_coh) / alpha, 0.1, 2.0);
  let rb = r * clamp(alpha / (alpha + a_coh), 0.1, 2.0);
  let n = vec2f(-t.y, t.x);
  let extent = ceil(max(ra, rb));
  // Schrittweite: höchstens ~12 Proben je Achse und Richtung
  let stride = max(1.0, extent / 12.0);
  var m: array<vec3f, 8>;
  var s: array<vec3f, 8>;
  var w: array<f32, 8>;
  for (var k = 0; k < N; k++) {
    m[k] = vec3f(0.0);
    s[k] = vec3f(0.0);
    w[k] = 0.0;
  }
  let q0 = canvas_px(p);
  var alpha_sum = 0.0;
  var alpha_w = 0.0;
  for (var y = -extent; y <= extent; y += stride) {
    for (var x = -extent; x <= extent; x += stride) {
      let v = vec2f(x, y);
      // in das Einheitskreis-System der Ellipse
      let e = vec2f(dot(v, t) / ra, dot(v, n) / rb);
      let d2 = dot(e, e);
      if (d2 > 1.0) { continue; }
      let px = sample_src_canvas(q0 + v);
      let col = unpremultiply(px).rgb;
      alpha_sum += px.a;
      alpha_w += 1.0;
      let radial = exp(-2.0 * d2);
      let len = sqrt(d2);
      let eu = select(vec2f(1.0, 0.0), e / len, len > 1e-6);
      for (var k = 0; k < N; k++) {
        // weiche, überlappende Sektorgewichte: cos³ des Winkels zur Sektormitte (Skalarprodukt, ohne atan2)
        let c = max(dot(eu, SECTOR[k]), 0.0);
        let wk = c * c * c * radial;
        if (wk <= 0.0) { continue; }
        m[k] += wk * col;
        s[k] += wk * col * col;
        w[k] += wk;
      }
    }
  }
  var out = vec3f(0.0);
  var total = 0.0;
  for (var k = 0; k < N; k++) {
    if (w[k] <= 0.0) { continue; }
    let mk = m[k] / w[k];
    let vk = max(s[k] / w[k] - mk * mk, vec3f(0.0));
    let sigma = sqrt(vk.r + vk.g + vk.b);
    let ak = 1.0 / (1.0 + pow(sigma * 255.0 / 10.0, params.sharpness));
    out += ak * mk;
    total += ak;
  }
  let a = select(load_src(p).a, alpha_sum / max(alpha_w, 1.0), alpha_w > 0.0);
  let rgb = select(unpremultiply(load_src(p)).rgb, out / max(total, 1e-6), total > 0.0);
  textureStore(dst, id.xy, premultiply(vec4f(rgb, a)));
}
