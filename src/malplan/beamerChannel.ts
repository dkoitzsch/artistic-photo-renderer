// Verbindung Hauptfenster ↔ Beamer-Fenster (gleicher Ursprung, BroadcastChannel).

import type { Corner } from './model';

export const BEAMER_CHANNEL = 'bls-malplan-beamer';

export type Corners = [Corner, Corner, Corner, Corner];

export type BeamerMessage =
  /** Beamer meldet sich (beim Öffnen) und fragt das Bild an */
  | { type: 'hello' }
  /** Hauptfenster: Bild (PNG) mit Seitenverhältnis und gespeicherten Ecken */
  | { type: 'image'; png: Blob; aspect: number; corners: Corners; label: string }
  /** Beamer: neue Ecken nach dem Ziehen (normiert auf das Beamer-Fenster) */
  | { type: 'corners'; corners: Corners };

export const DEFAULT_CORNERS: Corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export function isDefaultCorners(c: Corners): boolean {
  return c.every((p, i) => {
    const d = DEFAULT_CORNERS[i];
    return d !== undefined && p[0] === d[0] && p[1] === d[1];
  });
}
