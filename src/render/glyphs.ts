// Glyphen-Atlas für Effekte (ctx.glyphs): Zeichen per Canvas 2D in feste Zellen gerendert, als Textur hochgeladen und
// nach Zeichen, Schrift und Stärke gecacht. Kanal r (und a) = Deckung 0..1. Die Schriften sind die mitgelieferte Inter
// (OFL-1.1) und Systemschriften; gerenderte Bilder sind keine Schriftsoftware.

import type { GlyphAtlas, GlyphFont } from '../effects/api';

/** Zellgröße einer Glyphe im Atlas (Seitenverhältnis 0,6 wie eine Textzeile in Monospace). */
export const GLYPH_CELL: readonly [number, number] = [48, 80];
const FONT_PX = 62;
const MAX_ENTRIES = 24;
const MAX_GLYPHS = 1024;

const FAMILY: Record<GlyphFont, string> = {
  mono: 'ui-monospace, Menlo, "SF Mono", Monaco, monospace',
  sans: '"Inter Variable", Inter, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

type Entry = { atlas: GlyphAtlas; used: number };

export class GlyphCache {
  private readonly entries = new Map<string, Entry>();
  private tick = 0;

  constructor(private readonly device: GPUDevice) {}

  get(chars: string, font: GlyphFont = 'mono', weight = 500): GlyphAtlas {
    const list = Array.from(chars).slice(0, MAX_GLYPHS);
    if (list.length === 0) list.push(' ');
    const key = `${font}|${weight}|${list.join('')}`;
    const hit = this.entries.get(key);
    if (hit) {
      hit.used = ++this.tick;
      return hit.atlas;
    }
    const css = `${weight} ${FONT_PX}px ${FAMILY[font]}`;
    // Inter lädt mit der Oberfläche; ist sie (noch) nicht da, nicht cachen – der nächste Durchlauf rendert neu
    const ready = typeof document === 'undefined' || document.fonts.check(css);
    if (!ready) void document.fonts.load(css);
    const atlas = this.render(list, css);
    if (ready) {
      this.entries.set(key, { atlas, used: ++this.tick });
      this.evict();
    }
    return atlas;
  }

  private render(list: string[], css: string): GlyphAtlas {
    const [cw, ch] = GLYPH_CELL;
    const columns = Math.min(32, list.length);
    const rows = Math.ceil(list.length / columns);
    const canvas = new OffscreenCanvas(columns * cw, rows * ch);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('Canvas 2D nicht verfügbar');
    g.font = css;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    list.forEach((c, i) => {
      const x = (i % columns) * cw;
      const y = Math.floor(i / columns) * ch;
      g.save();
      g.beginPath();
      // 2 px Rand frei lassen: bilineare Abtastung greift nicht in die Nachbarzelle
      g.rect(x + 2, y + 2, cw - 4, ch - 4);
      g.clip();
      g.fillText(c, x + cw / 2, y + ch * 0.74);
      g.restore();
    });
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const coverage = list.map((_, i) => {
      const x0 = (i % columns) * cw;
      const y0 = Math.floor(i / columns) * ch;
      let sum = 0;
      for (let y = y0; y < y0 + ch; y++)
        for (let x = x0; x < x0 + cw; x++) sum += img.data[(y * canvas.width + x) * 4 + 3] ?? 0;
      return sum / (255 * cw * ch);
    });
    const texture = this.device.createTexture({
      label: 'glyph-atlas',
      size: [canvas.width, canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    // Deckung in alle Kanäle (r wird im Shader gelesen)
    const data = new Uint8Array(img.data.length);
    for (let i = 0; i < data.length; i += 4) {
      const a = img.data[i + 3] ?? 0;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = a;
    }
    this.device.queue.writeTexture({ texture }, data, { bytesPerRow: canvas.width * 4 }, [
      canvas.width,
      canvas.height,
    ]);
    return { texture, count: list.length, columns, cell: GLYPH_CELL, coverage };
  }

  private evict(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const oldest = [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of oldest.slice(0, this.entries.size - MAX_ENTRIES)) {
      // Textur erst nach dem Frame freigeben (kann im laufenden Encoder noch gebunden sein)
      const tex = e.atlas.texture;
      setTimeout(() => {
        tex.destroy();
      }, 1000);
      this.entries.delete(key);
    }
  }
}
