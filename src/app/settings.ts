// Globale Einstellungen (pro Browser): Lizenzmodus und ML-Modus.

import type { LicenseMode } from '../state/project';
import { setLicenseModeOfProject } from '../state/commands';
import { getProject, useAppStore, type MlMode } from '../state/store';

const KEY = 'bls.settings';
const NOTICE_KEY = 'bls.licenseNoticeShown';

type Settings = { licenseMode: LicenseMode; mlMode: MlMode };

export function loadSettings(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const s = useAppStore.getState();
    if (raw.licenseMode === 'all' || raw.licenseMode === 'commercial') s.setLicenseMode(raw.licenseMode);
    if (raw.mlMode === 'auto' || raw.mlMode === 'browser' || raw.mlMode === 'service')
      s.setMlMode(raw.mlMode);
  } catch {
    // Standardwerte
  }
}

function save(): void {
  const { licenseMode, mlMode } = useAppStore.getState();
  try {
    localStorage.setItem(KEY, JSON.stringify({ licenseMode, mlMode }));
  } catch {
    // ignorieren
  }
}

/** Ob der einmalige Hinweis zu den Lizenzfolgen schon gezeigt wurde. */
export function licenseNoticeShown(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markLicenseNoticeShown(): void {
  try {
    localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // ignorieren
  }
}

export function setLicenseMode(mode: LicenseMode): void {
  useAppStore.getState().setLicenseMode(mode);
  save();
  // Projektdatei speichert den Lizenzmodus (Spec)
  const project = getProject();
  if (project && project.licenseMode !== mode) setLicenseModeOfProject(mode);
}

export function setMlMode(mode: MlMode): void {
  useAppStore.getState().setMlMode(mode);
  save();
}
