import { defineEffect } from '../../src/effects/api';

/**
 * Datamosh in drei Pässen auf einem Blockgitter in Leinwand-Koordinaten (volle Auflösung, kachelgenau):
 * rows: 1-D-DCT je Blockzeile (8 Proben je Zeile, ggf. von verschobener Stelle),
 * cols: 1-D-DCT je Spalte + Quantisierung → Koeffizienten (8 × 8 Texel je Block),
 * idct: Rücktransformation je Pixel (stetig innerhalb des Blocks).
 */
export default defineEffect({
  run(ctx) {
    const s = ctx.scale;
    const B = Math.max(1, (ctx.params.blockSize as number) / s); // Blockgröße in Leinwand-px (volle Auflösung)
    // Blöcke, die den Ausgabeausschnitt berühren (Ursprung in voller Auflösung)
    const ox = ctx.origin[0] / s;
    const oy = ctx.origin[1] / s;
    const bx0 = Math.floor(ox / B);
    const by0 = Math.floor(oy / B);
    const bx1 = Math.floor((ox + ctx.width / s) / B);
    const by1 = Math.floor((oy + ctx.height / s) / B);
    const nbx = bx1 - bx0 + 1;
    const nby = by1 - by0 + 1;
    const rows = ctx.texture(nbx * 8, nby * 8);
    const coef = ctx.texture(nbx * 8, nby * 8);
    const data = [bx0, by0, B, 0];
    ctx.run('rows', { src: ctx.source, dst: rows, data });
    ctx.run('cols', { src: rows, dst: coef, data });
    ctx.run('idct', { src: ctx.source, srcB: coef, dst: ctx.output, data });
  },
});
