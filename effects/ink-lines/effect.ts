import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const sigma = ctx.params.thickness as number; // Render-px
    const l = ctx.texture(width, height);
    ctx.run('luma', { src: ctx.source, dst: l });
    const g1 = ctx.texture(width, height);
    const g2 = ctx.texture(width, height);
    ctx.gaussian(l, g1, 3 * sigma, 'clamp');
    ctx.gaussian(l, g2, 3 * sigma * 1.6, 'clamp');
    const d = ctx.texture(width, height);
    ctx.run('dog', { src: g1, srcB: g2, dst: d });
    const smooth = ctx.texture(width, height);
    const half = ((ctx.params.flow as number) / 100) * 4 * Math.max(sigma, 1);
    ctx.run('flow_smooth', { src: d, dst: smooth, data: [half] });
    ctx.run('ink', { src: ctx.source, srcB: smooth, dst: ctx.output });
  },
});
