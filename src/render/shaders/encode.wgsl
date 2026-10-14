// Export: linear, vormultipliziert (rgba16float) -> sRGB-kodiert, gerades Alpha (rgba8unorm).

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }
  let c = textureLoad(src, id.xy, 0);
  let a = clamp(c.a, 0.0, 1.0);
  var rgb = vec3f(0.0);
  if (a > 0.0) {
    rgb = clamp(c.rgb / a, vec3f(0.0), vec3f(1.0));
  }
  textureStore(dst, id.xy, vec4f(linear_to_srgb(rgb), a));
}
