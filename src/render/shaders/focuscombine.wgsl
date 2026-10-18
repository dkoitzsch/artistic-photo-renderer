// Fokuskarte = Fokuspunkte (a, r) verrechnet mit gemalten Bereichen (b, r; 0,5 = neutral, 1 = schärfer, 0 = unschärfer).
@group(0) @binding(0) var a_tex: texture_2d<f32>;
@group(0) @binding(1) var b_tex: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = clamp(textureLoad(a_tex, p, 0).r + (textureLoad(b_tex, p, 0).r - 0.5) * 2.0, 0.0, 1.0);
  textureStore(dst, id.xy, vec4f(f, f, f, 1.0));
}
