import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const fade = (ctx.params.edgeFade as number) / 100;
    const softness = ctx.params.softness as number;
    const longEdge = Math.max(ctx.canvasSize[0], ctx.canvasSize[1]);

    const alpha = ctx.texture(width, height);
    ctx.run('alpha', { src: ctx.source, dst: alpha });

    // Randausblendung: weichzeichnen und neu abbilden
    let shape = alpha;
    if (fade > 0) {
      const blurred = ctx.texture(width, height);
      ctx.gaussian(alpha, blurred, fade * 0.06 * longEdge, 'transparent');
      const faded = ctx.texture(width, height);
      ctx.run('fade', { src: blurred, dst: faded, data: [fade] });
      shape = faded;
    }

    const placed = ctx.texture(width, height);
    ctx.run('place', { src: shape, srcB: alpha, dst: placed });

    let soft = placed;
    if (softness > 0.3) {
      soft = ctx.texture(width, height);
      ctx.gaussian(placed, soft, softness, 'transparent');
    }
    ctx.run('colorize', { src: soft, dst: ctx.output });
  },
});
