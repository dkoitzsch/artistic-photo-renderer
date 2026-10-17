// Eigene Presets (projektübergreifend, OPFS presets/presets.json): laden, ändern, sichern, Export/Import.

import { create } from 'zustand';
import { loadPresetsFile, savePresetsFile } from '../io/storage';
import { newId } from '../state/project';
import {
  mergePresets,
  parsePresetFile,
  PRESET_FILE_FORMAT,
  type EffectPreset,
  type PresetFile,
  type StackPreset,
} from './model';

type PresetState = {
  loaded: boolean;
  effects: EffectPreset[];
  stacks: StackPreset[];
};

export const usePresetStore = create<PresetState>()(() => ({ loaded: false, effects: [], stacks: [] }));

function toFile(): PresetFile {
  const { effects, stacks } = usePresetStore.getState();
  return { format: PRESET_FILE_FORMAT, version: 1, effects, stacks };
}

let saving: Promise<void> = Promise.resolve();
function persist(): Promise<void> {
  const json = JSON.stringify(toFile());
  saving = saving.then(() => savePresetsFile(json)).catch(() => undefined);
  return saving;
}

/** Lädt die Presets einmal (beim Start); defekte Datei → leer, Hinweis über die Rückgabe. */
export async function loadPresets(): Promise<string | null> {
  if (usePresetStore.getState().loaded) return null;
  try {
    const text = await loadPresetsFile();
    const file = text ? parsePresetFile(JSON.parse(text)) : null;
    usePresetStore.setState({ loaded: true, effects: file?.effects ?? [], stacks: file?.stacks ?? [] });
    return null;
  } catch (e) {
    usePresetStore.setState({ loaded: true });
    return `Eigene Presets konnten nicht geladen werden: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export function addEffectPreset(p: Omit<EffectPreset, 'id' | 'createdAt'>): EffectPreset {
  const preset: EffectPreset = { ...p, id: newId(), createdAt: new Date().toISOString() };
  usePresetStore.setState((s) => ({ effects: [...s.effects, preset] }));
  void persist();
  return preset;
}

export function deleteEffectPreset(id: string): void {
  usePresetStore.setState((s) => ({ effects: s.effects.filter((p) => p.id !== id) }));
  void persist();
}

export function addStackPreset(p: Omit<StackPreset, 'id' | 'createdAt'>): StackPreset {
  const preset: StackPreset = { ...p, id: newId(), createdAt: new Date().toISOString() };
  usePresetStore.setState((s) => ({ stacks: [...s.stacks, preset] }));
  void persist();
  return preset;
}

export function deleteStackPreset(id: string): void {
  usePresetStore.setState((s) => ({ stacks: s.stacks.filter((p) => p.id !== id) }));
  void persist();
}

/** Alle eigenen Presets als JSON (Export). */
export function exportPresetsJson(): string {
  return JSON.stringify(toFile(), null, 2);
}

/** Importiert eine Preset-Datei; liefert die Anzahl übernommener Presets. */
export function importPresetsJson(text: string): { effects: number; stacks: number } {
  const file = parsePresetFile(JSON.parse(text));
  usePresetStore.setState((s) => ({
    effects: mergePresets(s.effects, file.effects),
    stacks: mergePresets(s.stacks, file.stacks),
  }));
  void persist();
  return { effects: file.effects.length, stacks: file.stacks.length };
}

/** Wartet, bis alle Schreibvorgänge abgeschlossen sind (Tests). */
export function presetsSaved(): Promise<void> {
  return saving;
}
