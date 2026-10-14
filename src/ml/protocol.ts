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
  | { type: 'error'; id: number; message: string }
  | { type: 'done'; id: number }
  | { type: 'download-state'; states: DownloadState[] };
