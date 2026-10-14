// Füllt eine Textur mit einer konstanten Farbe (leere Gruppen, Hilfstexturen).

@group(0) @binding(0) var<uniform> color: vec4f;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, color);
}
