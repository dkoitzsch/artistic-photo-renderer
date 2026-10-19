import { defineEffect } from '../../src/effects/api';

const MAX_GRID = 1536;

export default defineEffect({
  run(ctx) {
    const cw = ctx.canvasSize[0] / ctx.scale;
    const ch = ctx.canvasSize[1] / ctx.scale;
    const cell = Math.max(1, ctx.raw.cell as number);
    let gw = Math.max(16, Math.round(cw / cell));
    let gh = Math.max(16, Math.round(ch / cell));
    const f = Math.min(1, MAX_GRID / Math.max(gw, gh));
    gw = Math.max(16, Math.round(gw * f));
    gh = Math.max(16, Math.round(gh * f));
    // C0: Ausgangsfarbe (rgb) und -höhe (a); Zustand: r Höhe, g Wasser, b Sediment
    const c0 = ctx.texture(gw, gh);
    ctx.run('init_color', { src: ctx.source, dst: c0 });
    let a = ctx.texture(gw, gh);
    let a2 = ctx.texture(gw, gh);
    ctx.run('init_state', { src: c0, dst: a });
    const n = Math.max(1, Math.round(ctx.raw.iterations as number));
    for (let i = 0; i < n; i++) {
      ctx.run('step', { src: a, dst: a2, data: [i] });
      [a, a2] = [a2, a];
    }
    // mitgetragene Farbe: entlang der Strömung stromaufwärts, gewichtet mit Ab- bzw. Auftrag
    const carried = ctx.texture(gw, gh);
    ctx.run('carried', { src: a, srcB: c0, dst: carried });
    const lit = ctx.texture(ctx.width, ctx.height);
    ctx.run('relief', { src: ctx.source, srcB: a, dst: lit });
    ctx.run('blend', { src: lit, srcB: carried, dst: ctx.output });
  },
});
