import { defineEffect } from '../../src/effects/api';

const MAX_LEVEL_LENGTH = 40;

export default defineEffect({
  run(ctx) {
    const length = ctx.params.length as number;
    let levels = 0;
    while (length / 2 ** levels > MAX_LEVEL_LENGTH && levels < 6) levels++;
    const f = 2 ** levels;
    if (levels === 0) {
      ctx.run('smear', { src: ctx.source, dst: ctx.output, data: [1] });
      return;
    }
    let cur = ctx.source;
    let w = ctx.width;
    let h = ctx.height;
    for (let i = 0; i < levels; i++) {
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
      const next = ctx.texture(w, h);
      ctx.run('down', { src: cur, dst: next });
      cur = next;
    }
    const smeared = ctx.texture(w, h);
    ctx.run('smear', { src: cur, dst: smeared, data: [f] });
    ctx.run('compose', { src: smeared, srcB: ctx.source, dst: ctx.output, data: [f] });
  },
});
