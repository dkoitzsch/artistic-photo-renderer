import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useAppStore, type ThemePreference } from '../../state/store';

const STORAGE_KEY = 'bls.theme';
const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)');

export function loadThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Speicher nicht verfügbar → Systemeinstellung
  }
  return 'system';
}

export function saveThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignorieren
  }
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return darkQuery().matches ? 'dark' : 'light';
}

function subscribeSystemTheme(onChange: () => void): () => void {
  const mq = darkQuery();
  mq.addEventListener('change', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
  };
}

/** Setzt data-theme auf <html> und folgt der Systemeinstellung, solange keine Wahl gespeichert ist. */
export function useApplyTheme(): 'light' | 'dark' {
  const pref = useAppStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeSystemTheme, () => darkQuery().matches);
  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return resolved;
}

/** Schaltet zwischen hell und dunkel um und speichert die Wahl. */
export function toggleTheme(): void {
  const { theme, setTheme } = useAppStore.getState();
  const next = resolveTheme(theme) === 'dark' ? 'light' : 'dark';
  saveThemePreference(next);
  setTheme(next);
}
