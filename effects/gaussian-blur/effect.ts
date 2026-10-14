import { defineEffect, type EffectContext } from '../../src/effects/api';

/** Größtes σ (in Pixeln einer Stufe), das direkt gefaltet wird; darüber wird verkleinert. */
const MAX_LEVEL_SIGMA = 6;
const EDGES = ['mirror', 'clamp', 'transparent'] as const;

/** Gleichmäßige Unschärfe mit σ über Box-Pyramide, separablen Gauß und bilineares Hochskalieren. */
function uniformBlur(ctx: EffectContext, sigma: number, dst: GPUTexture): void {
  if (sigma < 0.25) {
    ctx.run('copy', { src: ctx.source, dst });
    return;
  }
  let levels = 0;
  while (sigma / 2 ** levels > MAX_LEVEL_SIGMA && levels < 12) levels++;
  const f = 2 ** levels;
  // Varianz, die Box-Verkleinerung und bilineares Hochskalieren bereits beitragen (in Original-px²)
  const boxVariance = (f * f - 1) / 12;
  const upVariance = levels > 0 ? (f * f) / 6 : 0;
  const levelSigma = Math.sqrt(Math.max(0.0625 * f * f, sigma * sigma - boxVariance - upVariance)) / f;

  let cur = ctx.source;
  let w = ctx.width;
  let h = ctx.height;
  for (let i = 0; i < levels; i++) {
    w = Math.ceil(w / 2);
    h = Math.ceil(h / 2);
    const next = ctx.texture(w, h);
    ctx.run('down', { src: cur, dst: next });
    cur = next;
  }
  const tmp = ctx.texture(w, h);
  ctx.run('blur', { src: cur, dst: tmp, data: [1, 0, levelSigma] });
  const blurred = levels === 0 ? dst : ctx.texture(w, h);
  ctx.run('blur', { src: tmp, dst: blurred, data: [0, 1, levelSigma] });
  if (levels > 0) ctx.run('up', { src: blurred, dst, data: [f] });
}

export default defineEffect({
  run(ctx) {
    const radius = ctx.params.radius as number; // px, bereits skaliert
    const focusRadius = (radius * (ctx.params.focusBlur as number)) / 100;
    const softness = (ctx.params.focusSoftness as number) / 100;

    if (!ctx.hasFocus || focusRadius >= radius * 0.999 || radius < 0.75) {
      uniformBlur(ctx, radius / 3, ctx.output);
      return;
    }

    // Stufen: σ = 0 (Original) und geometrisch (Faktor √2) bis zur vollen Stärke
    const sMax = radius / 3;
    const sMin = focusRadius / 3;
    const sigmas = [0];
    let s = Math.max(0.5, sMin);
    while (s < sMax) {
      sigmas.push(s);
      s *= Math.SQRT2;
    }
    sigmas.push(sMax);

    const edge = EDGES[ctx.params.edge as number] ?? 'mirror';
    let acc = ctx.texture(ctx.width, ctx.height);
    let next = ctx.texture(ctx.width, ctx.height);
    const level = ctx.texture(ctx.width, ctx.height);
    sigmas.forEach((sigma, k) => {
      const last = k === sigmas.length - 1;
      const src = k === 0 ? ctx.source : level;
      if (k > 0) ctx.gaussian(ctx.source, level, sigma * 3, edge);
      ctx.run('accumulate', {
        src,
        srcB: acc,
        dst: last ? ctx.output : next,
        data: [
          sigmas[k - 1] ?? 0,
          sigma,
          sigmas[k + 1] ?? sigma,
          k === 0 ? 1 : 0,
          radius,
          focusRadius,
          softness,
          last ? 1 : 0,
        ],
      });
      [acc, next] = [next, acc];
    });
  },
});
