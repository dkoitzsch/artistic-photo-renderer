// Golden-Fälle aller Effekte. Neue Effekte tragen hier mindestens einen Fall ein (feste Parameter, ggf. Seed).
import type { EffectCase } from './effectGolden';

export const EFFECT_CASES: EffectCase[] = [
  { name: 'gaussian-blur-portrait', fixture: 'portrait', effectId: 'gaussian-blur', params: { radius: 12 } },
  {
    name: 'motion-blur-architecture',
    fixture: 'architecture',
    effectId: 'motion-blur',
    params: { length: 24, angle: 30 },
    // ±1 Stufe: Rundung des 16-Bit-Arbeitsformats bei schräger Abtastung, keine sichtbare Naht
    tileTolerance: 1,
  },
  { name: 'zoom-blur-landscape', fixture: 'landscape', effectId: 'zoom-blur', params: { amount: 12 } },
  {
    name: 'lens-blur-still-life',
    fixture: 'still-life',
    effectId: 'lens-blur',
    params: { radius: 10 },
    tileTolerance: 1,
  },
  { name: 'haze-landscape', fixture: 'landscape', effectId: 'haze', params: { amount: 50 } },
  { name: 'black-white-portrait', fixture: 'portrait', effectId: 'black-white', preset: 'Rotfilter' },
  {
    name: 'color-overlay-architecture',
    fixture: 'architecture',
    effectId: 'color-overlay',
    params: { duotone: true },
  },
  // ---- E1 Schritt 9 ----
  {
    name: 'rgb-split-radial-portrait',
    fixture: 'portrait',
    effectId: 'rgb-split',
    params: { amount: 8, mode: 'radial' },
    // ±1: Rundung der bilinearen Abtastkoordinaten je Kachel
    tileTolerance: 1,
  },
  {
    name: 'rgb-split-linear-architecture',
    fixture: 'architecture',
    effectId: 'rgb-split',
    params: { amount: 12, mode: 'linear', angle: 30 },
  },
  { name: 'pixelate-square-still-life', fixture: 'still-life', effectId: 'pixelate', params: { size: 12 } },
  {
    name: 'pixelate-hex-median-landscape',
    fixture: 'landscape',
    effectId: 'pixelate',
    params: { size: 20, shape: 'hexagon', color: 'median' },
  },
  {
    name: 'film-grain-vintage-portrait',
    fixture: 'portrait',
    effectId: 'film-grain',
    preset: 'Vintage mit Lichteinfall',
    flatBorder: false,
  },
  {
    name: 'film-grain-cinestill-landscape',
    fixture: 'landscape',
    effectId: 'film-grain',
    preset: 'Cinestill (Halation)',
    flatBorder: false,
  },
  { name: 'bloom-traum-architecture', fixture: 'architecture', effectId: 'bloom', preset: 'Traum' },
  { name: 'tilt-shift-landscape', fixture: 'landscape', effectId: 'tilt-shift', preset: 'Miniatur' },
  {
    name: 'posterize-popart-portrait',
    fixture: 'portrait',
    effectId: 'posterize-palette',
    preset: 'Pop-Art',
  },
  {
    name: 'posterize-erdtoene-still-life',
    fixture: 'still-life',
    effectId: 'posterize-palette',
    preset: 'Erdtöne',
  },
];
