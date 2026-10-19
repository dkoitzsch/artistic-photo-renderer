import { defineEffect } from '../../src/effects/api';

const MAX_GRID = 2048;

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
    let a = ctx.texture(gw, gh);
    let b = ctx.texture(gw, gh);
    ctx.run('init', { src: ctx.source, dst: a });
    // Schritte aus der gewünschten Astlänge (Zellen) und der Wachstumsrate (Zellen je Schritt)
    const rate = Math.max(0.05, (ctx.raw.rate as number) / 100);
    const n = Math.max(
      1,
      Math.min(4000, Math.round((((ctx.raw.growth as number) / 100) * Math.max(gw, gh)) / rate)),
    );
    for (let i = 0; i < n; i++) {
      ctx.run('grow', { src: a, dst: b, data: [i, n] });
      [a, b] = [b, a];
    }
    // Schimmer: geglätteter Kristall als Lichthof
    const glow = ctx.texture(gw, gh);
    ctx.gaussian(a, glow, 4, 'clamp');
    const packed = ctx.texture(gw, gh);
    ctx.run('pack', { src: a, srcB: glow, dst: packed });
    ctx.run('compose', { src: ctx.source, srcB: packed, dst: ctx.output });
  },
});
