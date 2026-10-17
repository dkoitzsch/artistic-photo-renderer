import { defineEffect } from '../../src/effects/api';

export default defineEffect({
  run(ctx) {
    const soften = ctx.params.soften as number;
    if (soften >= 0.3) {
      const soft = ctx.texture(ctx.width, ctx.height);
      ctx.gaussian(ctx.source, soft, soften, 'mirror');
      ctx.run('quantize', { src: soft, dst: ctx.output });
    } else {
      ctx.run('quantize', { src: ctx.source, dst: ctx.output });
    }
  },
});
