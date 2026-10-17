import { defineEffect } from '../../src/effects/api';

const HEX_ROW = Math.sqrt(3) / 2;

export default defineEffect({
  run(ctx) {
    const size = Math.max(1, ctx.params.size as number); // Render-px
    const hex = (ctx.params.shape as number) === 1;
    const rowH = hex ? size * HEX_ROW : size;
    // Zellen, die den Ausschnitt berühren (mit Rand)
    const [ox, oy] = ctx.origin;
    const cx0 = Math.floor(ox / size) - 2;
    const cy0 = Math.floor(oy / rowH) - 2;
    const cx1 = Math.ceil((ox + ctx.width) / size) + 2;
    const cy1 = Math.ceil((oy + ctx.height) / rowH) + 2;
    const cells = ctx.texture(cx1 - cx0, cy1 - cy0);
    ctx.run('cells', { src: ctx.source, dst: cells, data: [cx0, cy0] });
    ctx.run('apply', { src: ctx.source, srcB: cells, dst: ctx.output, data: [cx0, cy0] });
  },
});
