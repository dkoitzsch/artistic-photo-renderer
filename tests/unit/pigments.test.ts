// Pigment-Engine (Spec „Effekte“ 6.3): Mischung, Rezeptsuche, Randfälle.
import { describe, expect, it } from 'vitest';
import { PIGMENTS, findMix, formatRecipe, mix, recipeParts } from '../../src/pigments/engine';
import {
  BANDS,
  deltaE2000,
  hexToSrgb,
  reflectanceFromSrgb,
  spectrumToLinear,
  encodeSrgb,
  srgbToLab,
} from '../../src/pigments/spectral';

const hue = (lab: readonly number[]) => {
  const h = (Math.atan2(lab[2] ?? 0, lab[1] ?? 0) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};
const chroma = (lab: readonly number[]) => Math.hypot(lab[1] ?? 0, lab[2] ?? 0);

/** Standardpalette aus 10 Farben */
const PALETTE = [
  'titanium-white',
  'ivory-black',
  'ultramarine',
  'phthalo-blue',
  'cadmium-yellow-light',
  'yellow-ochre',
  'burnt-sienna',
  'cadmium-red-light',
  'alizarin-permanent',
  'phthalo-green',
];

describe('Spektren', () => {
  it('rekonstruiert glatte Spektren 0…1, die die Farbe wiedergeben', () => {
    for (const hex of ['#c8902e', '#1c2a7d', '#808080', '#e0ac8c']) {
      const r = reflectanceFromSrgb(hexToSrgb(hex));
      expect(r).toHaveLength(BANDS);
      expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...r)).toBeLessThanOrEqual(1);
      const back = spectrumToLinear(r).map(encodeSrgb);
      expect(deltaE2000(srgbToLab(back), srgbToLab(hexToSrgb(hex)))).toBeLessThan(0.5);
    }
  });

  it('ΔE2000 stimmt mit Referenzwerten (Sharma et al.) überein', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000([50, -1, 2], [50, -1, 2])).toBe(0);
    expect(deltaE2000([2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514])).toBeCloseTo(0.9082, 3);
  });
});

describe('Mischen (Kubelka-Munk)', () => {
  it('Datenbank: mindestens 20 Pigmente mit Colour-Index; Vollton und Aufhellung werden wiedergegeben', () => {
    expect(PIGMENTS.length).toBeGreaterThanOrEqual(20);
    for (const p of PIGMENTS) {
      expect(p.ci).toMatch(/^P/);
      const m = mix([{ id: p.id, parts: 1 }]);
      expect(deltaE2000(m.lab, srgbToLab(hexToSrgb(p.masstone)))).toBeLessThan(1);
      if (!p.white) {
        const t = mix([
          { id: p.id, parts: 1 },
          { id: 'titanium-white', parts: 4 },
        ]);
        expect(deltaE2000(t.lab, srgbToLab(hexToSrgb(p.tint)))).toBeLessThan(1);
      }
    }
  });

  it('Blau + Gelb ergibt sichtbar Grün', () => {
    for (const [blue, yellow] of [
      ['ultramarine', 'cadmium-yellow-light'],
      ['phthalo-blue', 'hansa-yellow'],
    ] as const) {
      const g = mix([
        { id: blue, parts: 1 },
        { id: yellow, parts: 2 },
      ]).lab;
      expect(hue(g)).toBeGreaterThan(110);
      expect(hue(g)).toBeLessThan(200);
      expect(chroma(g)).toBeGreaterThan(15);
    }
  });

  it('Komplementärmischungen ergeben gebrochene Töne statt Mittelgrau', () => {
    for (const [a, b] of [
      ['ultramarine', 'burnt-sienna'],
      ['cadmium-red-light', 'phthalo-green'],
    ] as const) {
      // Verhältnis mit der geringsten Buntheit (Farbstärken unterscheiden sich, z. B. Phthalo sehr stark)
      let best = mix([{ id: a, parts: 1 }]).lab;
      for (let t = 0.02; t < 1; t += 0.02) {
        const m = mix([
          { id: a, parts: 1 - t },
          { id: b, parts: t },
        ]).lab;
        if (chroma(m) < chroma(best)) best = m;
      }
      const la = mix([{ id: a, parts: 1 }]).lab;
      const lb = mix([{ id: b, parts: 1 }]).lab;
      // deutlich entsättigt …
      expect(chroma(best)).toBeLessThan(Math.min(chroma(la), chroma(lb)) * 0.6);
      // … und dunkel statt Mittelgrau aus dem RGB-Mittel
      const rgbMean = srgbToLab(
        hexToSrgb(mix([{ id: a, parts: 1 }]).hex).map(
          (v, i) => (v + (hexToSrgb(mix([{ id: b, parts: 1 }]).hex)[i] ?? 0)) / 2,
        ),
      );
      expect(best[0]).toBeLessThan(rgbMean[0]);
    }
  });

  it('Weiß hellt auf, ohne den Farbton zu kippen', () => {
    const pure = mix([{ id: 'ultramarine', parts: 1 }]).lab;
    const tint = mix([
      { id: 'ultramarine', parts: 1 },
      { id: 'titanium-white', parts: 2 },
    ]).lab;
    expect(tint[0]).toBeGreaterThan(pure[0] + 20);
    expect(Math.abs(hue(tint) - hue(pure))).toBeLessThan(25);
  });

  it('Mischung ohne Anteile ist ein Fehler', () => {
    expect(() => mix([])).toThrow();
    expect(() => mix([{ id: 'ultramarine', parts: 0 }])).toThrow();
  });
});

describe('Rezeptsuche (findMix)', () => {
  it('typische Fototöne mit 10 Farben: ΔE2000 < 5', () => {
    for (const hex of [
      '#e0ac8c',
      '#c69277',
      '#7aa5d6',
      '#4f6b2a',
      '#6b4a33',
      '#9a9a9a',
      '#c63c3c',
      '#2f3b4f',
      '#d9c9a3',
    ]) {
      const r = findMix(hexToSrgb(hex), PALETTE);
      expect(r.deltaE, `${hex}: ${formatRecipe(r)}`).toBeLessThan(5);
      expect(r.parts.length).toBeLessThanOrEqual(3);
      expect(r.parts.reduce((s, p) => s + p.fraction, 0)).toBeCloseTo(1, 6);
    }
  });

  it('Out-of-Gamut: Rezept trotzdem, Abweichung wird gemeldet', () => {
    const r = findMix(hexToSrgb('#00ff00'), PALETTE);
    expect(r.deltaE).toBeGreaterThan(5);
    expect(r.parts.length).toBeGreaterThan(0);
  });

  it('nur Weiß: Weiß trifft Weiß, Rot ist nicht erreichbar', () => {
    expect(findMix(hexToSrgb('#f5f5f2'), ['titanium-white']).deltaE).toBeLessThan(1);
    const red = findMix(hexToSrgb('#c63c3c'), ['titanium-white']);
    expect(red.parts.map((p) => p.id)).toEqual(['titanium-white']);
    expect(red.deltaE).toBeGreaterThan(20);
  });

  it('eine Farbe: genau diese, ohne Weiß bleibt der Vollton', () => {
    const r = findMix(hexToSrgb('#8a3b1c'), ['burnt-sienna']);
    expect(r.parts).toEqual([{ id: 'burnt-sienna', fraction: 1 }]);
    expect(r.deltaE).toBeLessThan(1);
  });

  it('Rezept in Teilen: kleine Anteile heißen „etwas“', () => {
    const r = findMix(hexToSrgb('#7aa5d6'), PALETTE);
    const parts = recipeParts(r);
    expect(parts.some((p) => p.parts !== null)).toBe(true);
    for (const p of parts) if (p.parts !== null) expect(p.parts).toBeLessThanOrEqual(6);
    expect(formatRecipe(r)).toMatch(/Teil/);
    expect(
      formatRecipe({
        parts: [
          { id: 'ultramarine', fraction: 0.6 },
          { id: 'burnt-sienna', fraction: 0.33 },
          { id: 'titanium-white', fraction: 0.07 },
        ],
        result: mix([{ id: 'ultramarine', parts: 1 }]),
        deltaE: 0,
      }),
    ).toBe('2 Teile Ultramarinblau + 1 Teil Siena gebrannt + etwas Titanweiß');
  });
});

describe('Dünne Schichten (Kubelka-Munk)', () => {
  it('Schicht der Dicke 0 = Untergrund, sehr dicke Schicht = Vollton', async () => {
    const { layerReflectance, mixConstants } = await import('../../src/pigments/engine');
    const { K, S } = mixConstants([{ id: 'ultramarine', parts: 1 }]);
    const i = 15;
    const k = K[i] ?? 0;
    const s = S[i] ?? 0;
    expect(layerReflectance(k, s, 0, 0.9)).toBeCloseTo(0.9, 6);
    const rInf = 1 + k / s - Math.sqrt((k / s) ** 2 + 2 * (k / s));
    expect(layerReflectance(k, s, 1000, 0.9)).toBeCloseTo(rInf, 4);
    // dünne Schicht liegt dazwischen und wird mit der Dicke dunkler
    const thin = layerReflectance(k, s, 0.05, 0.9);
    const thick = layerReflectance(k, s, 0.5, 0.9);
    expect(thin).toBeLessThan(0.9);
    expect(thick).toBeLessThan(thin);
  });
});
