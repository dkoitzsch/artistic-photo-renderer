// Erzeugt synthetische Testbilder (keine Lizenzfragen). Aufruf: npm run fixtures
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const W = 400;
const H = 300;
const png = new PNG({ width: W, height: H });

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let r = Math.round((x / (W - 1)) * 255);
    let g = Math.round((y / (H - 1)) * 255);
    let b = 128;
    let a = 255;
    // Mitte: einfarbige Fläche (Prüfung der Anzeige)
    if (x >= 100 && x < 300 && y >= 75 && y < 225) [r, g, b] = [30, 160, 220];
    // unten rechts: halbtransparent
    if (x >= 320 && y >= 240) [r, g, b, a] = [240, 200, 40, 128];
    // oben rechts: voll transparent
    if (x >= 360 && y < 40) a = 0;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  }
}

const out = new URL('./synthetic-400x300.png', import.meta.url);
writeFileSync(out, PNG.sync.write(png));
console.log('geschrieben:', out.pathname);
