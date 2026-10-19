import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const r = ctx.params.radius as number;
    const b1 = ctx.texture(width, height);
    const b2 = ctx.texture(width, height);
    ctx.gaussian(ctx.source, b1, Math.max(0.5, r / 3), 'clamp');
    ctx.gaussian(ctx.source, b2, Math.max(0.5, r), 'clamp');
    const blurred = ctx.texture(width, height);
    // Unschärfe je nach Vergessen: zwischen Original, b1 und b2 mischen
    ctx.run('blur_mix', { src: b1, srcB: b2, dst: blurred });
    ctx.run('decay', { src: ctx.source, srcB: blurred, dst: ctx.output });
  },
});
