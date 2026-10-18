// Pinseltupfer (Basis-Spec g): je Instanz ein Quadrat um den Tupfer, Deckung radial mit weichem Rand (Härte).
// Farbe = Zielwert (1 hinzufügen, 0 entfernen), Alpha = Deckung · Fluss; die Mischung „über“ (src-alpha) in
// Malreihenfolge ergibt den Aufbau bei mehrfachem Malen. Ziel: r-Kanal einer Arbeitstextur.

struct P { size: vec2f, _p0: vec2f }
@group(0) @binding(0) var<uniform> pu: P;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,      // Lage im Tupfer, Radius = 1
  @location(1) alpha: f32,
  @location(2) hardness: f32,
  @location(3) target_v: f32,
}

@vertex
fn vs(
  @builtin(vertex_index) vi: u32,
  @location(0) center: vec2f,
  @location(1) radius: f32,
  @location(2) alpha: f32,
  @location(3) hardness: f32,
  @location(4) target_v: f32,
) -> VOut {
  var corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
  let c = corners[vi];
  // 1 px Rand für die Kantenglättung
  let r = radius + 1.0;
  let px = center + c * r;
  var o: VOut;
  o.pos = vec4f(px.x / pu.size.x * 2.0 - 1.0, 1.0 - px.y / pu.size.y * 2.0, 0.0, 1.0);
  o.local = c * r / max(radius, 1e-3);
  o.alpha = alpha;
  o.hardness = hardness;
  o.target_v = target_v;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.local);
  // harter Kern bis hardness, danach weicher Abfall; Kante immer etwa 1 px geglättet
  let edge = max(1.0 - in.hardness, 0.02);
  let cover = 1.0 - smoothstep(1.0 - edge, 1.0, d);
  let a = clamp(cover * in.alpha, 0.0, 1.0);
  return vec4f(in.target_v, in.target_v, in.target_v, a);
}
