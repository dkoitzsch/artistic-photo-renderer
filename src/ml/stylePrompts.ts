// Prompt-Vorlagen der Stil-Übertragung (FLUX u. a. Bildbearbeitungsmodelle mit Referenzbildern).
// „Bild 1“ ist das zu bearbeitende Bild, „Bild 2“ das Stilbild. Englisch, weil die Modelle so am besten folgen.
// Die Vorlagen lassen sich in den Einstellungen anpassen (pro Browser gespeichert) und im Effekt je Lauf überschreiben.

import { create } from 'zustand';

export type PromptPresetId = 'faithful' | 'painterly' | 'colour' | 'custom';

export const PROMPT_PRESETS: { id: Exclude<PromptPresetId, 'custom'>; label: string; prompt: string }[] = [
  {
    id: 'faithful',
    label: 'Stiltreu (Inhalt bleibt)',
    prompt:
      'Redraw image 1 in the artistic style of image 2. Match its brush work, colour palette, texture, lighting and mood. ' +
      'Keep the exact composition, subjects, pose and proportions of image 1 unchanged. Do not add or remove objects.',
  },
  {
    id: 'painterly',
    label: 'Malerisch frei',
    prompt:
      'Reinterpret image 1 as if the same artist who made image 2 had painted it. Adopt that medium, stroke character, ' +
      'colour harmony and atmosphere, and simplify details the way image 2 does. Subjects and layout of image 1 stay recognisable.',
  },
  {
    id: 'colour',
    label: 'Nur Farbe und Licht',
    prompt:
      'Apply the colour grading, tonal range, lighting mood and film characteristics of image 2 to image 1. ' +
      'Do not change the shapes, textures, details or composition of image 1.',
  },
];

export const CUSTOM_LABEL = 'Eigener Prompt';
const KEY = 'bls.stylePrompts';

type Overrides = Partial<Record<Exclude<PromptPresetId, 'custom'>, string>>;

function load(): Overrides {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: Overrides = {};
    for (const p of PROMPT_PRESETS) {
      const v = raw[p.id];
      if (typeof v === 'string' && v.trim()) out[p.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

type PromptState = {
  overrides: Overrides;
  setTemplate: (id: Exclude<PromptPresetId, 'custom'>, text: string) => void;
  resetTemplate: (id: Exclude<PromptPresetId, 'custom'>) => void;
};

function persist(o: Overrides): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // ohne localStorage: nur für diese Sitzung
  }
}

export const useStylePrompts = create<PromptState>((set, get) => ({
  overrides: load(),
  setTemplate: (id, text) => {
    const next = { ...get().overrides, [id]: text };
    persist(next);
    set({ overrides: next });
  },
  resetTemplate: (id) => {
    const { [id]: _drop, ...rest } = get().overrides;
    persist(rest);
    set({ overrides: rest });
  },
}));

/** Text einer Vorlage (eigene Fassung aus den Einstellungen oder Standard). */
export function templateText(id: PromptPresetId, overrides = useStylePrompts.getState().overrides): string {
  if (id === 'custom') return '';
  const base = PROMPT_PRESETS.find((p) => p.id === id);
  return overrides[id] ?? base?.prompt ?? '';
}

export function isPresetId(v: unknown): v is PromptPresetId {
  return v === 'custom' || PROMPT_PRESETS.some((p) => p.id === v);
}
