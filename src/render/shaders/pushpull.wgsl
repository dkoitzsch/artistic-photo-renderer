// Lochfüllung per Push-Pull (normalisierte Faltung über eine Pyramide):
// Pixel unter dem Loch (Gewicht 0) werden aus der Umgebung aufgefüllt, ohne Lochfarben zu verwenden.
// Datenformat in der Pyramide: (rgb · w, w).

struct PP { factor: f32, _p0: f32, _p1: f32, _p2: f32 }

@group(0) @binding(0) var<uniform> pp: PP;
@group(0) @binding(1) var src_a: texture_2d<f32>;  // init: Bild; down: Stufe; pull: feine Stufe
@group(0) @binding(2) var src_b: texture_2d<f32>;  // init: Loch-Maske (r, 1 = Loch); pull: grobe Stufe
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = textureLoad(src_a, vec2i(id.xy), 0);
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let hole = textureSampleLevel(src_b, samp, uv, 0.0).r;
  // Schon leicht vom Loch berührte Pixel (Haarkanten mit Vordergrundfarbe) zählen nicht mit
  let w = 1.0 - smoothstep(0.02, 0.2, hole);
  var rgb = vec3f(0.0);
  if (c.a > 0.0) { rgb = c.rgb / c.a; }
  textureStore(dst, id.xy, vec4f(rgb * w, w));
}

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let s = vec2i(textureDimensions(src_a)) - vec2i(1);
  let p = vec2i(id.xy) * 2;
  var sum = vec4f(0.0);
  for (var y = -1; y <= 2; y++) {
    for (var x = -1; x <= 2; x++) {
      // 4 × 4-Fenster mit Gewichten (1,3,3,1)² für glatte Füllung
      let wx = select(3.0, 1.0, x == -1 || x == 2);
      let wy = select(3.0, 1.0, y == -1 || y == 2);
      sum += textureLoad(src_a, clamp(p + vec2i(x, y), vec2i(0), s), 0) * wx * wy;
    }
  }
  sum /= 64.0;
  // auf Gewicht 1 normieren, sobald genug Information da ist
  let w = sum.a;
  if (w > 0.0) { sum = vec4f(sum.rgb / w, 1.0) * min(w * 4.0, 1.0); }
  textureStore(dst, id.xy, sum);
}

@compute @workgroup_size(8, 8)
fn pull(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let fine = textureLoad(src_a, vec2i(id.xy), 0);
  let lp = (vec2f(id.xy) + 0.5) / pp.factor;
  let coarse = textureSampleLevel(src_b, samp, lp / vec2f(textureDimensions(src_b)), 0.0);
  var cc = vec3f(0.0);
  if (coarse.a > 0.0) { cc = coarse.rgb / coarse.a; }
  let w = clamp(fine.a, 0.0, 1.0);
  textureStore(dst, id.xy, vec4f(fine.rgb + cc * (1.0 - w), 1.0));
}

// Ergebnis: Farbe (deckend), außerhalb des Lochs das Original
@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let f = textureLoad(src_a, vec2i(id.xy), 0);
  var rgb = vec3f(0.0);
  if (f.a > 0.0) { rgb = f.rgb / f.a; }
  textureStore(dst, id.xy, vec4f(rgb, 1.0));
}
