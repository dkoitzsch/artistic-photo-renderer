// Compositor: legt einen Layer (vormultipliziert, linear) mit Deckkraft über die Basis.
// Phase 1: Mischmodus "normal". Weitere Mischmodi folgen mit mehreren Layern (siehe DECISIONS.md).

struct BlendParams {
  opacity: f32,
  mode: u32,
  has_base: u32,
  _p: f32,
}

@group(0) @binding(0) var<uniform> bp: BlendParams;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var layer: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let l = textureLoad(layer, p, 0) * bp.opacity;
  var b = vec4f(0.0);
  if (bp.has_base != 0u) {
    b = textureLoad(base, p, 0);
  }
  textureStore(dst, p, l + b * (1.0 - l.a));
}
