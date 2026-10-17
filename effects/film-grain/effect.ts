import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    if ((ctx.params.halation as number) > 0) {
      const bright = ctx.texture(width, height);
      ctx.run('bright', { src: ctx.source, dst: bright });
      const halo = ctx.texture(width, height);
      ctx.gaussian(bright, halo, ctx.params.halationRadius as number, 'clamp');
      ctx.run('combine', { src: ctx.source, srcB: halo, dst: ctx.output });
    } else {
      ctx.run('combine', { src: ctx.source, dst: ctx.output });
    }
  },
});
