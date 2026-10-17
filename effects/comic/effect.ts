import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const sigma = Math.max(0.5, ctx.params.outline as number);
    const soft = ctx.texture(width, height);
    ctx.gaussian(ctx.source, soft, 1.5 * ctx.scale, 'clamp');
    const l = ctx.texture(width, height);
    ctx.run('luma', { src: soft, dst: l });
    const g1 = ctx.texture(width, height);
    const g2 = ctx.texture(width, height);
    ctx.gaussian(l, g1, 3 * sigma, 'clamp');
    ctx.gaussian(l, g2, 3 * sigma * 1.6, 'clamp');
    const lines = ctx.texture(width, height);
    ctx.run('edges_dog', { src: g1, srcB: g2, dst: lines });
    ctx.run('cel', { src: soft, srcB: lines, dst: ctx.output });
  },
});
