import { defineEffect } from '../../src/effects/api';

const SETS: Record<string, string> = {
  standard: ' .:-=+*#%@',
  fine: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks: ' ░▒▓█',
  binary: '01',
  dots: ' ·•●',
};
const FONTS = ['mono', 'sans', 'serif'] as const;
const CHARSETS = ['standard', 'fine', 'blocks', 'binary', 'dots', 'text'] as const;

/**
 * ASCII: Glyphen-Atlas nach Dichte sortiert (Zeichensätze) bzw. in Textreihenfolge (eigener Text), ein Pass.
 * pass_data.v0 = (Anzahl Glyphen, Spalten des Atlas, Textmodus 0/1, –), v1 = (Atlas-Zelle w, h, Atlas w, h)
 */
export default defineEffect({
  run(ctx) {
    const charset = CHARSETS[ctx.params.charset as number] ?? 'standard';
    const font = FONTS[ctx.params.font as number] ?? 'mono';
    const weight = Number(ctx.raw.weight ?? 400) || 400;
    const textMode = charset === 'text';
    let chars = textMode ? String(ctx.raw.text ?? '') : (SETS[charset] ?? ' .:-=+*#%@');
    if (chars.length === 0) chars = ' ';
    let atlas = ctx.glyphs(chars, font, weight);
    if (!textMode) {
      // nach Deckung sortieren: Index 0 = hellstes (leerstes) Zeichen
      const list = Array.from(chars);
      const order = list.map((c, i) => ({ c, d: atlas.coverage[i] ?? 0 })).sort((a, b) => a.d - b.d);
      atlas = ctx.glyphs(order.map((o) => o.c).join(''), font, weight);
    }
    ctx.run('ascii', {
      src: ctx.source,
      srcB: atlas.texture,
      dst: ctx.output,
      data: [
        atlas.count,
        atlas.columns,
        textMode ? 1 : 0,
        0,
        atlas.cell[0],
        atlas.cell[1],
        atlas.texture.width,
        atlas.texture.height,
      ],
    });
  },
});
