import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const L = Math.max(ctx.canvasSize[0], ctx.canvasSize[1]);
    const radius = ((ctx.raw.blur as number) / 100) * L;
    const subjectRadius = (radius * (ctx.raw.subjectBlur as number)) / 100;
    const glowRadius = ((ctx.raw.glowSize as number) / 100) * L;

    // weiche Unschärfe des Hintergrunds und (schwächer) des Motivs
    let bg = ctx.source;
    if (radius >= 0.75) {
      bg = ctx.texture(ctx.width, ctx.height);
      ctx.gaussian(ctx.source, bg, radius, 'mirror');
    }
    let subj = ctx.source;
    if (subjectRadius >= 0.75) {
      subj = ctx.texture(ctx.width, ctx.height);
      ctx.gaussian(ctx.source, subj, subjectRadius, 'mirror');
    }
    const mixed = ctx.texture(ctx.width, ctx.height);
    ctx.run('mix_focus', { src: bg, srcB: subj, dst: mixed });

    // Leuchten: helle Flächen herausziehen und stark weichzeichnen
    const bright = ctx.texture(ctx.width, ctx.height);
    ctx.run('highlights', { src: ctx.source, dst: bright });
    const glow = ctx.texture(ctx.width, ctx.height);
    if (glowRadius >= 0.75) ctx.gaussian(bright, glow, glowRadius, 'mirror');
    else ctx.run('highlights', { src: bright, dst: glow });

    ctx.run('compose', { src: mixed, srcB: glow, dst: ctx.output });
  },
});
