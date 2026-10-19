import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const l = ctx.texture(width, height);
    ctx.run('height', { src: ctx.source, dst: l });
    const lo = ctx.texture(width, height);
    ctx.gaussian(l, lo, Math.max(1, 3 * (ctx.params.brush as number)), 'clamp');
    const shading = ctx.texture(width, height);
    ctx.run('shade', { src: l, srcB: lo, dst: shading });
    ctx.run('compose', { src: ctx.source, srcB: shading, dst: ctx.output });
  },
});
