import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    // Lückenfüllung „aus der Umgebung“: stark geglättetes Bild
    const blurred = ctx.texture(ctx.width, ctx.height);
    ctx.gaussian(ctx.source, blurred, Math.max(4, (ctx.params.fragment as number) * 0.6), 'clamp');
    ctx.run('compose', { src: ctx.source, srcB: blurred, dst: ctx.output });
  },
});
