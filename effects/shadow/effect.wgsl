// Schatten aus dem Alpha der (maskierten) Ebene: Randausblendung → Versatz/Perspektive → Verlauf → Weichheit → Farbe.
// Ausgabe vormultipliziert (Farbe · Deckung); Deckkraft und Mischmodus regelt der Schatten-Layer.

// Alpha der Quelle in alle Kanäle
@compute @workgroup_size(8, 8)
fn alpha(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let a = load_src(vec2i(id.xy)).a;
  textureStore(dst, id.xy, vec4f(a));
}

// Randausblendung: geglättete Maske neu abbilden (schrumpft und läuft weich aus). v0.x = Stärke 0…1
@compute @workgroup_size(8, 8)
fn fade(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let f = pass_data.v0.x;
  let a = load_src(vec2i(id.xy)).r;
  let lo = 0.5 * f;
  let v = smoothstep(lo, 1.0, a);
  textureStore(dst, id.xy, vec4f(v));
}

// Versatz + Perspektive (Skalierung/Neigung um die Bodenlinie) + Verlauf.
// src = Schattenform (ausgeblendet), src_b = Alpha des Objekts (für den Abstand zum Objekt)
@compute @workgroup_size(8, 8)
fn place(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let q = vec2f(id.xy) + 0.5 + params.origin;            // Render-px auf der Leinwand
  let dir = vec2f(cos(params.direction), sin(params.direction));
  let offset = dir * params.distance;
  let s = params.shadowScale / 100.0;
  let anchor_y = params.groundLine / 100.0 * params.canvas_size.y;
  let k = tan(params.tilt * 0.01745329);
  // Umkehrung der Abbildung: y' = a + (y − a)·s ; x' = x + (a − y)·s·k ; dann + Versatz
  let p = q - offset;
  let y = anchor_y + (p.y - anchor_y) / s;
  let x = p.x - (anchor_y - y) * s * k;
  let local = vec2f(x, y) - params.origin;
  let a = textureSampleLevel(src, linear_sampler, local / vec2f(src_size()), 0.0).r;
  var out = a;
  if (params.gradient > 0.0 && a > 0.0) {
    // Abstand zum Objekt entgegen der Richtung suchen
    let reach = max(params.distance * 2.5 + 20.0 * params.scale, 1.0);
    var d = reach;
    let bsize = vec2f(textureDimensions(src_b));
    for (var i = 0; i <= 24; i++) {
      let t = f32(i) / 24.0 * reach;
      let sp = (q - dir * t - params.origin) / bsize;
      if (textureSampleLevel(src_b, linear_sampler, sp, 0.0).r > 0.5) {
        d = t;
        break;
      }
    }
    out = a * (1.0 - params.gradient / 100.0 * clamp(d / reach, 0.0, 1.0));
  }
  textureStore(dst, id.xy, vec4f(out));
}

// Farbe auftragen (vormultipliziert)
@compute @workgroup_size(8, 8)
fn colorize(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let a = clamp(load_src(vec2i(id.xy)).r, 0.0, 1.0);
  textureStore(dst, id.xy, vec4f(params.color * a, a));
}
