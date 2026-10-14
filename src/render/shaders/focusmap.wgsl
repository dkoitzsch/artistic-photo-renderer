// Fokuskarte: radiale Verläufe um Fokuspunkte. r = max_i clamp(1 − d_i / r_i, 0, 1)  (1 = scharf)

struct Point { pos: vec2f, radius: f32, enabled: f32 }
struct F {
  origin: vec2f,   // Lage des Ausschnitts in Render-px
  scale: f32,      // Render-px pro Leinwand-px
  count: u32,
  points: array<Point, 64>,
}

@group(0) @binding(0) var<uniform> f: F;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = (vec2f(id.xy) + 0.5 + f.origin) / f.scale;   // Leinwand-px
  var v = 0.0;
  for (var i = 0u; i < f.count; i++) {
    let pt = f.points[i];
    if (pt.enabled < 0.5 || pt.radius <= 0.0) { continue; }
    v = max(v, clamp(1.0 - distance(p, pt.pos) / pt.radius, 0.0, 1.0));
  }
  textureStore(dst, id.xy, vec4f(v, v, v, 1.0));
}
