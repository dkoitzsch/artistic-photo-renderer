import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const radius = ctx.params.radius as number;
    const bright = ctx.texture(width, height);
    ctx.run('bright', { src: ctx.source, dst: bright });
    const wide = ctx.texture(width, height);
    const mid = ctx.texture(width, height);
    const near = ctx.texture(width, height);
    ctx.gaussian(bright, wide, radius, 'clamp');
    ctx.gaussian(bright, mid, radius / 2, 'clamp');
    ctx.gaussian(bright, near, radius / 4, 'clamp');
    const acc = ctx.texture(width, height);
    ctx.run('add2', { src: wide, srcB: mid, dst: acc, data: [0.5, 0.3] });
    const glow = ctx.texture(width, height);
    ctx.run('add2', { src: acc, srcB: near, dst: glow, data: [1, 0.2] });
    ctx.run('combine', { src: ctx.source, srcB: glow, dst: ctx.output });
  },
});
