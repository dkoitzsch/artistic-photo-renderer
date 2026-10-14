// Undo/Redo. Befehle (Command-Pattern) beschreiben die Änderung mit Namen; gespeichert wird der
// unveränderliche Projektzustand danach (Memento) – dank strukturellem Teilen klein (siehe DECISIONS.md).

export type HistoryEntry<T> = {
  label: string;
  state: T;
  /** Gleicher Schlüssel innerhalb einer Geste → Eintrag wird ersetzt statt angehängt (Reglerbewegung). */
  coalesceKey?: string;
};

export type History<T> = {
  entries: HistoryEntry<T>[];
  /** Index des aktuellen Zustands */
  index: number;
  limit: number;
};

export const DEFAULT_HISTORY_LIMIT = 500;

export function createHistory<T>(initial: T, label = 'Geöffnet', limit = DEFAULT_HISTORY_LIMIT): History<T> {
  return { entries: [{ label, state: initial }], index: 0, limit };
}

export function present<T>(h: History<T>): T {
  const e = h.entries[h.index];
  if (!e) throw new Error('History leer');
  return e.state;
}

export function push<T>(h: History<T>, label: string, state: T, coalesceKey?: string): History<T> {
  const current = h.entries[h.index];
  if (current?.state === state) return h;
  // Zusammenfassen: nur, wenn der aktuelle Eintrag der letzte ist und denselben Schlüssel trägt.
  if (
    coalesceKey !== undefined &&
    current?.coalesceKey === coalesceKey &&
    h.index === h.entries.length - 1 &&
    h.index > 0
  ) {
    const entries = h.entries.slice(0, h.index);
    entries.push({ label, state, coalesceKey });
    return { ...h, entries };
  }
  let entries = h.entries.slice(0, h.index + 1);
  entries.push(coalesceKey === undefined ? { label, state } : { label, state, coalesceKey });
  if (entries.length > h.limit) entries = entries.slice(entries.length - h.limit);
  return { ...h, entries, index: entries.length - 1 };
}

/** Beendet eine Geste: der nächste Eintrag mit gleichem Schlüssel wird nicht mehr zusammengefasst. */
export function sealCoalescing<T>(h: History<T>): History<T> {
  const e = h.entries[h.index];
  if (e?.coalesceKey === undefined) return h;
  const entries = h.entries.slice();
  entries[h.index] = { label: e.label, state: e.state };
  return { ...h, entries };
}

export const canUndo = <T>(h: History<T>): boolean => h.index > 0;
export const canRedo = <T>(h: History<T>): boolean => h.index < h.entries.length - 1;

export function undo<T>(h: History<T>): History<T> {
  return canUndo(h) ? jump(sealCoalescing(h), h.index - 1) : h;
}

export function redo<T>(h: History<T>): History<T> {
  return canRedo(h) ? jump(h, h.index + 1) : h;
}

export function jump<T>(h: History<T>, index: number): History<T> {
  const i = Math.max(0, Math.min(h.entries.length - 1, index));
  return i === h.index ? h : { ...sealCoalescing(h), index: i };
}
