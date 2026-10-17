import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const { width, height } = ctx;
    const blur = ctx.params.blur as number;
    const levels = [1 / 3, 2 / 3, 1].map((f) => {
      const t = ctx.texture(width, height);
      ctx.gaussian(ctx.source, t, blur * f, 'mirror');
      return t;
    });
    let cur = ctx.source;
    levels.forEach((lv, k) => {
      const out = ctx.texture(width, height);
      ctx.run('level', { src: cur, srcB: lv, dst: out, data: [k] });
      cur = out;
    });
    ctx.run('saturate', { src: cur, dst: ctx.output });
  },
});
