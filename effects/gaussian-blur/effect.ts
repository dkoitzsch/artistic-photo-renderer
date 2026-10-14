import { defineEffect } from '../../src/effects/api';

/** Größtes σ (in Pixeln einer Stufe), das direkt gefaltet wird; darüber wird verkleinert. */
const MAX_LEVEL_SIGMA = 6;

export default defineEffect({
  run(ctx) {
    const radius = ctx.params.radius as number; // px, bereits skaliert
    const sigma = radius / 3;
    if (sigma < 0.25) {
      ctx.run('copy', { src: ctx.source, dst: ctx.output });
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
    const blurred = levels === 0 ? ctx.output : ctx.texture(w, h);
    ctx.run('blur', { src: tmp, dst: blurred, data: [0, 1, levelSigma] });
    if (levels > 0) ctx.run('up', { src: blurred, dst: ctx.output, data: [f] });
  },
});
