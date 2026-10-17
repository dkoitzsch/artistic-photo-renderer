import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const n = Math.max(1, Math.round(ctx.params.iterations as number));
    let cur = ctx.source;
    for (let i = 0; i < n; i++) {
      const dst = i === n - 1 ? ctx.output : ctx.texture(ctx.width, ctx.height);
      ctx.run('kuwahara', { src: cur, dst });
      cur = dst;
    }
  },
});
