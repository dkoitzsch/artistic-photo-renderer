// Kern-Gauß (für Masken, Schatten, Plugins über ctx.gaussian): Box-Pyramide + separabler Gauß + bilinear hoch.
// Gleiches Verfahren wie effects/gaussian-blur, aber mit eigenem Uniform statt Plugin-Parametern.

struct G {
  dir: vec2f,
  sigma: f32,
  edge: u32,    // 0 Spiegeln, 1 Klemmen, 2 Transparent
  factor: f32,  // Hochskalierungsfaktor (up)
  _p0: f32,
  _p1: f32,
  _p2: f32,
}

@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn edge_load(p: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(src));
  if (all(p >= vec2i(0)) && all(p < size)) { return textureLoad(src, p, 0); }
  if (g.edge == 2u) { return vec4f(0.0); }
  var q = p;
  if (g.edge == 0u) {
    let period = 2 * size;
    q = ((q % period) + period) % period;
    q = select(q, period - 1 - q, q >= size);
  }
  return textureLoad(src, clamp(q, vec2i(0), size - vec2i(1)), 0);
}

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = edge_load(p) + edge_load(p + vec2i(1, 0)) + edge_load(p + vec2i(0, 1)) + edge_load(p + vec2i(1, 1));
  textureStore(dst, id.xy, c * 0.25);
}

@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let dir = vec2i(g.dir);
  let r = i32(ceil(3.0 * g.sigma));
  let k = -0.5 / (g.sigma * g.sigma);
  let p = vec2i(id.xy);
  var sum = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -r; i <= r; i++) {
    let w = exp(f32(i * i) * k);
    sum += edge_load(p + dir * i) * w;
    wsum += w;
  }
  textureStore(dst, id.xy, sum / wsum);
}

@compute @workgroup_size(8, 8)
fn up(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let lp = (vec2f(id.xy) + 0.5) / g.factor;
  textureStore(dst, id.xy, textureSampleLevel(src, samp, lp / vec2f(textureDimensions(src)), 0.0));
}

@compute @workgroup_size(8, 8)
fn copy(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, textureLoad(src, vec2i(id.xy), 0));
}
