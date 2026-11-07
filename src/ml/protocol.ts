// Nachrichten zwischen App und ML-Worker.

import type { LicenseMode } from '../state/project';

export type Progress = { stage: 'download' | 'load' | 'infer'; label: string; loaded: number; total: number };

export type Landmark = { x: number; y: number; visibility?: number };

/** Zustand einer Modelldatei im Browser-Cache */
export type DownloadState = {
  modelId: string;
  name: string;
  status: 'missing' | 'downloading' | 'paused' | 'verifying' | 'done' | 'error';
  loaded: number;
  total: number;
  error?: string | undefined;
};

export type DownloadCommand = 'scan' | 'start' | 'pause' | 'stop' | 'delete';
export type LandmarkResult = { faces: Landmark[][]; poses: Landmark[][] };

export type WorkerRequest =
  | {
      type: 'segment';
      id: number;
      modelId: string;
      licenseMode: LicenseMode;
      image: ImageBitmap;
      /** nur Entwicklung/Tests: Basis-URL eines lokalen Modell-Spiegels */
      mirror?: string | null;
    }
  | { type: 'landmarks'; id: number; image: ImageBitmap; licenseMode: LicenseMode; mirror?: string | null }
  | {
      type: 'depth';
      id: number;
      modelId: string;
      licenseMode: LicenseMode;
      image: ImageBitmap;
      mirror?: string | null;
    }
  | {
      /** Smarte Auswahl: Bildmerkmale je key (z. B. Original-ID) zwischengespeichert; image beim ersten Mal */
      type: 'sam';
      id: number;
      modelId: string;
      licenseMode: LicenseMode;
      key: string;
      image?: ImageBitmap;
      /** Klickpunkte normiert 0..1, Kennung 1 = gehört dazu, 0 = gehört nicht dazu */
      points: [number, number, number][];
      mirror?: string | null;
    }
  | {
      /** Objekt-Aufteilung: Raster von Punktaufforderungen (grid × grid) → Instanzmasken (Etikettenkarte) */
      type: 'sam-objects';
      id: number;
      modelId: string;
      licenseMode: LicenseMode;
      key: string;
      image?: ImageBitmap;
      grid: number;
      maxObjects: number;
      mirror?: string | null;
    }
  | {
      type: 'downloads';
      id: number;
      cmd: DownloadCommand;
      modelId?: string;
      licenseMode: LicenseMode;
      mirror?: string | null;
    };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: Progress }
  | { type: 'segment-result'; id: number; mask: Float32Array; width: number; height: number; ms: number }
  | { type: 'landmarks-result'; id: number; result: LandmarkResult; ms: number }
  /** Wahrscheinlichkeit 0..1 je Pixel (256 × 256 über das gestreckte Bild); needImage: Merkmale fehlen */
  | { type: 'sam-result'; id: number; mask: Float32Array; width: number; height: number; ms: number }
  | { type: 'sam-need-image'; id: number }
  /** Etikettenkarte (0 = kein Objekt) 256 × 256 über das gestreckte Bild und die gewählten Objekte */
  | {
      type: 'sam-objects-result';
      id: number;
      labels: Uint16Array;
      width: number;
      height: number;
      objects: { label: number; score: number; area: number }[];
      ms: number;
    }
  | { type: 'error'; id: number; message: string }
  | { type: 'done'; id: number }
  | { type: 'download-state'; states: DownloadState[] };
