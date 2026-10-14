// Ebene × Maske (vormultipliziert: alle Kanäle mit dem Maskenwert multiplizieren).

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  textureStore(dst, p, textureLoad(src, p, 0) * textureLoad(mask, p, 0).r);
}
