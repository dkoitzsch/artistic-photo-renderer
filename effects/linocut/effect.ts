import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const l = ctx.texture(width, height);
    ctx.run('luma', { src: ctx.source, dst: l });
    const smooth = ctx.texture(width, height);
    ctx.gaussian(l, smooth, Math.max(0.5, 3 * (ctx.params.simplify as number)), 'clamp');
    ctx.run('cut', { src: ctx.source, srcB: smooth, dst: ctx.output });
  },
});
