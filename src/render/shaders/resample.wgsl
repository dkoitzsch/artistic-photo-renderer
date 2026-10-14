// Verkleinern mit Flächenfilter (exakte Pixelabdeckung), für die Vorschau-Auflösung.

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dsize = textureDimensions(dst);
  if (id.x >= dsize.x || id.y >= dsize.y) { return; }
  let ssize = vec2f(textureDimensions(src));
  let ratio = ssize / vec2f(dsize);
  let a = vec2f(id.xy) * ratio;
  let b = min(a + ratio, ssize);
  let i0 = vec2i(floor(a));
  let i1 = min(vec2i(ceil(b)), i0 + vec2i(32));
  var sum = vec4f(0.0);
  var wsum = 0.0;
  for (var y = i0.y; y < i1.y; y++) {
    let wy = min(b.y, f32(y + 1)) - max(a.y, f32(y));
    for (var x = i0.x; x < i1.x; x++) {
      let wx = min(b.x, f32(x + 1)) - max(a.x, f32(x));
      let w = wx * wy;
      sum += textureLoad(src, vec2i(x, y), 0) * w;
      wsum += w;
    }
  }
  textureStore(dst, id.xy, sum / max(wsum, 1e-8));
}
