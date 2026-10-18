import { defineEffect } from '../../src/effects/api';

/** Prägung: Höhenfeld = geglättete Helligkeit (Kern-Gauß), danach Beleuchtung aus dem Gradienten. */
export default defineEffect({
  run(ctx) {
    const smooth = ctx.texture(ctx.width, ctx.height);
    ctx.gaussian(ctx.source, smooth, ctx.params.softness as number, 'clamp');
    ctx.run('emboss', { src: ctx.source, srcB: smooth, dst: ctx.output });
  },
});
