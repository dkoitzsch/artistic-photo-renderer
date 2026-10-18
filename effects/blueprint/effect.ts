import { defineEffect } from '../../src/effects/api';

/** Blaupause: Differenz zweier Gauß-Filter (Linien), danach Einfärben mit Raster und Schattierung. */
export default defineEffect({
  run(ctx) {
    const w = Math.max(0.3, ctx.params.lineWidth as number); // Render-px
    const fine = ctx.texture(ctx.width, ctx.height);
    const coarse = ctx.texture(ctx.width, ctx.height);
    ctx.gaussian(ctx.source, fine, w * 1.2, 'clamp');
    ctx.gaussian(ctx.source, coarse, w * 1.2 * 1.6, 'clamp');
    ctx.run('blueprint', { src: fine, srcB: coarse, dst: ctx.output });
  },
});
