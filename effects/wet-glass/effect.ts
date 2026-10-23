import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const L = Math.max(ctx.canvasSize[0], ctx.canvasSize[1]);
    const heavy = ((ctx.raw.fogBlur as number) / 100) * L;
    const medium = heavy * 0.3;

    // zwei Unschärfestufen; je nach Beschlagfeld wird zwischen ihnen gemischt (soft)
    const med = ctx.texture(ctx.width, ctx.height);
    const hvy = ctx.texture(ctx.width, ctx.height);
    if (medium >= 0.75) ctx.gaussian(ctx.source, med, medium, 'mirror');
    else ctx.run('copy_src', { src: ctx.source, dst: med });
    if (heavy >= 0.75) ctx.gaussian(ctx.source, hvy, heavy, 'mirror');
    else ctx.run('copy_src', { src: ctx.source, dst: hvy });
    const soft = ctx.texture(ctx.width, ctx.height);
    ctx.run('blend_blur', { src: med, srcB: hvy, dst: soft });
    ctx.run('compose', { src: ctx.source, srcB: soft, dst: ctx.output });
  },
});
