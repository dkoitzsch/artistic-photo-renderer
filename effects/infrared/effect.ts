import { defineEffect } from '../../src/effects/api';

/** Infrarot: Falschfarben je Pixel, danach Leuchten aus einer weichgezeichneten Fassung (Halation des Films). */
export default defineEffect({
  run(ctx) {
    const ir = ctx.texture(ctx.width, ctx.height);
    ctx.run('convert', { src: ctx.source, dst: ir });
    const glow = (ctx.params.glow as number) > 0;
    if (!glow) {
      ctx.run('finish', { src: ir, srcB: ir, dst: ctx.output });
      return;
    }
    const blurred = ctx.texture(ctx.width, ctx.height);
    ctx.gaussian(ir, blurred, ctx.params.glowRadius as number, 'clamp');
    ctx.run('finish', { src: ir, srcB: blurred, dst: ctx.output });
  },
});
