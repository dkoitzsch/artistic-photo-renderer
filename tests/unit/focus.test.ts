import { describe, expect, it } from 'vitest';
import { focusPointsFromLandmarks } from '../../src/ml/focus';
import type { Landmark } from '../../src/ml/protocol';

let n = 0;
const id = () => `p${++n}`;

function pose(over: Record<number, Landmark>): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => over[i] ?? { x: 0.5, y: 2, visibility: 0 });
}

describe('focusPointsFromLandmarks', () => {
  it('Gesicht: zwei Augen und Gesichtsmitte, sortiert von links nach rechts', () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4 }));
    for (const i of [33, 133, 159, 145, 468]) face[i] = { x: 0.6, y: 0.35 };
    for (const i of [362, 263, 386, 374, 473]) face[i] = { x: 0.4, y: 0.35 };
    face[234] = { x: 0.3, y: 0.4 };
    face[454] = { x: 0.7, y: 0.4 };
    const pts = focusPointsFromLandmarks({ faces: [face], poses: [] }, 1000, 1000, id);
    expect(pts.map((p) => p.label)).toEqual(['Auge links', 'Auge rechts', 'Gesichtsmitte']);
    expect(pts[0]?.x).toBe(400);
    expect(pts[0]?.radius).toBe(88); // 0,22 × Gesichtsbreite 400 px
  });

  it('Pose: Brust und sichtbare Hände; Punkte knapp außerhalb werden an den Rand gesetzt', () => {
    const p = pose({
      11: { x: 0.7, y: 0.8, visibility: 1 },
      12: { x: 0.3, y: 0.8, visibility: 1 },
      15: { x: 0.2, y: 0.6, visibility: 0.9 },
      17: { x: 0.2, y: 0.6, visibility: 0.9 },
      19: { x: 0.2, y: 0.6, visibility: 0.9 },
      21: { x: 0.2, y: 0.6, visibility: 0.9 },
      0: { x: 0.5, y: 0.3, visibility: 1 },
    });
    const faceDummy = [Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.3 }))];
    const pts = focusPointsFromLandmarks({ faces: faceDummy, poses: [p] }, 1000, 1000, id);
    const chest = pts.find((x) => x.kind === 'chest');
    expect(chest).toBeDefined();
    expect(chest?.y).toBe(900);
    expect(pts.filter((x) => x.kind === 'hand')).toHaveLength(1);
  });

  it('ohne Face-Mesh: Augen und Gesicht aus der Pose', () => {
    const p = pose({
      0: { x: 0.5, y: 0.4, visibility: 1 },
      2: { x: 0.55, y: 0.35, visibility: 1 },
      5: { x: 0.45, y: 0.35, visibility: 1 },
      7: { x: 0.6, y: 0.37, visibility: 1 },
      8: { x: 0.4, y: 0.37, visibility: 1 },
      9: { x: 0.52, y: 0.45, visibility: 1 },
      10: { x: 0.48, y: 0.45, visibility: 1 },
    });
    const pts = focusPointsFromLandmarks({ faces: [], poses: [p] }, 1000, 1000, id);
    expect(pts.map((x) => x.kind)).toEqual(['eye', 'eye', 'face']);
  });

  it('verwirft Punkte weit außerhalb des Bildes', () => {
    const p = pose({ 15: { x: 0.2, y: 1.6, visibility: 0.9 } });
    expect(focusPointsFromLandmarks({ faces: [], poses: [p] }, 1000, 1000, id)).toHaveLength(0);
  });
});
