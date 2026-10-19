import { defineEffect } from '../../src/effects/api';

/** Größter Radius (Stufen-px) für die Abtastung; darüber wird verkleinert (wie lens-blur). */
const MAX_LEVEL_RADIUS = 20;

export default defineEffect({
  run(ctx) {
    const radius = ctx.params.radius as number;
    let levels = 0;
    while (radius / 2 ** levels > MAX_LEVEL_RADIUS && levels < 6) levels++;
    const f = 2 ** levels;
    if (levels === 0) {
      ctx.run('gather', { src: ctx.source, dst: ctx.output, data: [1] });
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
    const lens = ctx.texture(w, h);
    ctx.run('gather', { src: cur, dst: lens, data: [f] });
    ctx.run('compose', { src: lens, srcB: ctx.source, dst: ctx.output, data: [f] });
  },
});
