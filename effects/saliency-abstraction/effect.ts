import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const r = ctx.params.radius as number;
    // Abstraktionsstufen: Original, Radius ¼, ½ und ganz; je Pixel wird zwischen den Stufen gemischt
    const stages = [r / 4, r / 2, r].map((radius) => {
      const t = ctx.texture(width, height);
      ctx.gaussian(ctx.source, t, Math.max(0.5, radius), 'clamp');
      return t;
    });
    let cur = ctx.source;
    stages.forEach((blurred, k) => {
      const out = k === stages.length - 1 ? ctx.output : ctx.texture(width, height);
      ctx.run('stage', { src: cur, srcB: blurred, dst: out, data: [k] });
      cur = out;
    });
  },
});
