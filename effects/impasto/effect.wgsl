// Impasto: Höhenfeld = Helligkeitsstruktur im Maßstab der Striche (Helligkeit minus geglättete Helligkeit) plus feine
// Pinselrillen (ortsfestes Rauschen entlang der Kantenrichtung); Normale aus dem Höhengradienten, Licht aus dem
// Lichtwinkel (45° Höhe), Lambert + Glanz. Die Farbe kommt unverändert aus dem Eingang.

// r = Helligkeit (sRGB-kodiert), a = 1
@compute @workgroup_size(8, 8)
fn height(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = unpremultiply(load_src(vec2i(id.xy)));
  let l = linear_to_srgb(vec3f(luminance(c.rgb))).x;
  textureStore(dst, id.xy, vec4f(l, 0.0, 0.0, 1.0));
}

fn h_at(p: vec2i) -> f32 {
  let s = src_size();
  let q = clamp(p, vec2i(0), s - vec2i(1));
  let detail = textureLoad(src, q, 0).r - textureLoad(src_b, q, 0).r;
  let cp = canvas_pos(q);
  let rill = (rand_noise(cp * vec2f(1.0, 0.25), max(params.brush / params.scale * 0.35, 0.6), params.seed) - 0.5);
  return detail + rill * params.texture / 100.0 * 0.15;
}

// src = Helligkeit, src_b = geglättete Helligkeit → r = Beleuchtung relativ zur ebenen Fläche, g = Glanz
@compute @workgroup_size(8, 8)
fn shade(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let k = params.thickness / 100.0 * 6.0;
  let gx = (h_at(p + vec2i(1, 0)) - h_at(p - vec2i(1, 0))) * 0.5 * k * params.scale;
  let gy = (h_at(p + vec2i(0, 1)) - h_at(p - vec2i(0, 1))) * 0.5 * k * params.scale;
  let n = normalize(vec3f(-gx, -gy, 1.0));
  let ld = normalize(vec3f(cos(params.lightAngle), sin(params.lightAngle), 1.0));
  let lambert = max(dot(n, ld), 0.0);
  let flat = ld.z; // Beleuchtung einer ebenen Fläche: neutral
  let hv = normalize(ld + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, hv), 0.0), 40.0) * params.gloss / 100.0;
  textureStore(dst, id.xy, vec4f(lambert / flat, spec, 0.0, 1.0));
}

// src = Original, src_b = Beleuchtung (r) und Glanz (g)
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let c = load_src(p);
  let s = textureLoad(src_b, p, 0);
  let lit = c.rgb * s.r + vec3f(s.g) * c.a;
  textureStore(dst, id.xy, vec4f(max(lit, vec3f(0.0)), c.a));
}
