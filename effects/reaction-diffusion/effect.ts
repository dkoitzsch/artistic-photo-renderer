import { defineEffect } from '../../src/effects/api';

/** Größte Rasterkante (Speicher und Laufzeit) */
const MAX_GRID = 2048;

export default defineEffect({
  run(ctx) {
    // Simulationsraster in Leinwand-px: gleich in Vorschau und Export
    const cw = ctx.canvasSize[0] / ctx.scale;
    const ch = ctx.canvasSize[1] / ctx.scale;
    const cell = Math.max(1, ctx.raw.cell as number);
    let gw = Math.max(16, Math.round(cw / cell));
    let gh = Math.max(16, Math.round(ch / cell));
    const f = Math.min(1, MAX_GRID / Math.max(gw, gh));
    gw = Math.max(16, Math.round(gw * f));
    gh = Math.max(16, Math.round(gh * f));
    let a = ctx.texture(gw, gh);
    let b = ctx.texture(gw, gh);
    ctx.run('init', { src: ctx.source, dst: a });
    const n = Math.max(1, Math.round(ctx.raw.iterations as number));
    for (let i = 0; i < n; i++) {
      ctx.run('step', { src: a, dst: b });
      [a, b] = [b, a];
    }
    ctx.run('compose', { src: ctx.source, srcB: a, dst: ctx.output });
  },
});
