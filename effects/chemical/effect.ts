import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const start = ctx.texture(width, height);
    ctx.run('start', { src: ctx.source, dst: start });
    const spread = ctx.texture(width, height);
    ctx.gaussian(start, spread, Math.max(1, ctx.params.spread as number), 'clamp');
    ctx.run('apply', { src: ctx.source, srcB: spread, dst: ctx.output });
  },
});
