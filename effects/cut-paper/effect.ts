import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const prep = ctx.texture(width, height);
    ctx.run('prep', { src: ctx.source, dst: prep });
    const smooth = ctx.texture(width, height);
    ctx.gaussian(prep, smooth, Math.max(1, 3 * (ctx.params.simplify as number)), 'clamp');
    ctx.run('compose', { src: ctx.source, srcB: smooth, dst: ctx.output });
  },
});
