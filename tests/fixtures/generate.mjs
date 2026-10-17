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

// Scharfe Kanten und feine Linien (deckend) für Unschärfe-Golden-Tests
{
  const W2 = 256;
  const H2 = 192;
  const img = new PNG({ width: W2, height: H2 });
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W2; x++) {
      const i = (y * W2 + x) * 4;
      let c = [235, 232, 225];
      if (x >= 20 && x < 90 && y >= 30 && y < 160) c = [20, 20, 24];
      if ((x - 170) ** 2 + (y - 70) ** 2 < 40 ** 2) c = [210, 40, 50];
      if ((x - 200) ** 2 + (y - 150) ** 2 < 22 ** 2) c = [30, 90, 220];
      if (x % 16 === 0 && y > 170) c = [0, 0, 0];
      if (y === 10 || x === 250) c = [255, 200, 0];
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  const out2 = new URL('./sharp-256x192.png', import.meta.url);
  writeFileSync(out2, PNG.sync.write(img));
  console.log('geschrieben:', out2.pathname);
}

// Gleichmäßig graue Fläche: Randprüfung der Effekte (eine Fläche muss bis zum Rand gleichmäßig bleiben)
{
  const W3 = 160;
  const H3 = 120;
  const img = new PNG({ width: W3, height: H3 });
  for (let i = 0; i < W3 * H3; i++) img.data.set([128, 128, 128, 255], i * 4);
  const out3 = new URL('./golden/flat-gray.png', import.meta.url);
  writeFileSync(out3, PNG.sync.write(img));
  console.log('geschrieben:', out3.pathname);
}
