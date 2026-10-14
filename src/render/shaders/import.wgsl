// Import: sRGB-kodiert, gerades Alpha (rgba8unorm) -> linear, vormultipliziert (rgba16float).

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(src);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let s = textureLoad(src, id.xy, 0);
  textureStore(dst, id.xy, vec4f(srgb_to_linear(s.rgb) * s.a, s.a));
}
