// Merkt sich pro Browser-Tab das offene Projekt, damit ein Neuladen (auch durch Vite bei Plugin-Änderungen)
// direkt dorthin zurückführt. Ein neuer Tab startet mit der Projektübersicht.

import { selectProject, useAppStore } from '../state/store';

const KEY = 'bls.openProject';

export function rememberedProjectId(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function startSessionMemory(): () => void {
  let last: string | null = null;
  return useAppStore.subscribe((s) => {
    const id = selectProject(s)?.id ?? null;
    if (id === last) return;
    last = id;
    try {
      if (id) sessionStorage.setItem(KEY, id);
      else sessionStorage.removeItem(KEY);
    } catch {
      // ignorieren
    }
  });
}
