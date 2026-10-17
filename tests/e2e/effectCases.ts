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
];
