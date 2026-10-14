// Fokuspunkte aus MediaPipe-Landmarken: Augen, Gesichtsmitte, Brust, Hände (in Leinwand-px).

import type { FocusPoint, FocusPointKind } from '../state/project';
import type { Landmark, LandmarkResult } from './protocol';

// Indizes im Face-Mesh (478 Punkte inkl. Iris)
const LEFT_EYE = [33, 133, 159, 145, 468];
const RIGHT_EYE = [362, 263, 386, 374, 473];
const CHEEK_L = 234;
const CHEEK_R = 454;
// Pose (33 Punkte)
const SHOULDER_L = 11;
const SHOULDER_R = 12;
const HIP_L = 23;
const HIP_R = 24;
const HAND_L = [15, 17, 19, 21];
const HAND_R = [16, 18, 20, 22];
// Kopf aus der Pose (Ersatz, wenn das Face-Mesh nichts findet)
const POSE_EYE_L = 2;
const POSE_EYE_R = 5;
const POSE_NOSE = 0;
const POSE_MOUTH = [9, 10];
const POSE_EARS = [7, 8];
/** Punkte bis zu diesem Anteil außerhalb des Bildes werden an den Rand gesetzt, weiter draußen verworfen. */
const OUTSIDE_TOLERANCE = 0.15;

const MIN_VISIBILITY = 0.5;

type P = { x: number; y: number };

function mean(points: (Landmark | undefined)[]): P | null {
  const valid = points.filter((p): p is Landmark => p !== undefined);
  if (!valid.length) return null;
  return {
    x: valid.reduce((s, p) => s + p.x, 0) / valid.length,
    y: valid.reduce((s, p) => s + p.y, 0) / valid.length,
  };
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Wandelt normierte Landmarken (0…1) in Fokuspunkte um. width/height: Größe der Leinwand.
 * Radien richten sich nach Gesichts- bzw. Schulterbreite.
 */
export function focusPointsFromLandmarks(
  lm: LandmarkResult,
  width: number,
  height: number,
  newId: () => string,
): FocusPoint[] {
  const px = (p: P): P => ({ x: p.x * width, y: p.y * height });
  const pick = (list: Landmark[], idx: number[]) => idx.map((i) => list[i]);
  const out: FocusPoint[] = [];
  const add = (kind: FocusPointKind, label: string, p: P, radius: number) => {
    out.push({
      id: newId(),
      kind,
      label,
      x: Math.round(p.x),
      y: Math.round(p.y),
      radius: Math.max(4, Math.round(radius)),
      enabled: true,
    });
  };
  const multi = lm.faces.length > 1 || lm.poses.length > 1;

  lm.faces.forEach((face, i) => {
    const suffix = multi ? ` ${i + 1}` : '';
    const l = mean(pick(face, LEFT_EYE));
    const r = mean(pick(face, RIGHT_EYE));
    const cl = face[CHEEK_L];
    const cr = face[CHEEK_R];
    const center = mean(face);
    if (!center || !cl || !cr) return;
    const faceWidth = dist(px(cl), px(cr));
    // Bildlinks/-rechts (aus Sicht des Betrachters)
    const eyes = [l, r].filter((e): e is P => e !== null).sort((a, b) => a.x - b.x);
    eyes.forEach((e, k) => {
      add('eye', `Auge ${k === 0 ? 'links' : 'rechts'}${suffix}`, px(e), faceWidth * 0.22);
    });
    add('face', `Gesichtsmitte${suffix}`, px(center), faceWidth * 0.75);
  });

  lm.poses.forEach((pose, i) => {
    const suffix = multi ? ` ${i + 1}` : '';
    const vis = (idx: number) => {
      const p = pose[idx];
      return p && (p.visibility ?? 1) >= MIN_VISIBILITY ? p : undefined;
    };
    // Kein Gesicht vom Face-Mesh? Augen und Gesichtsmitte aus der Pose.
    if (lm.faces.length === 0) {
      const ears = POSE_EARS.map(vis).filter((e): e is Landmark => e !== undefined);
      const el = vis(POSE_EYE_L);
      const er = vis(POSE_EYE_R);
      const faceWidth =
        ears.length === 2 && ears[0] && ears[1]
          ? dist(px(ears[0]), px(ears[1]))
          : el && er
            ? dist(px(el), px(er)) * 2.2
            : 0;
      if (faceWidth > 0) {
        const eyes = [el, er].filter((e): e is Landmark => e !== undefined).sort((a, b) => a.x - b.x);
        eyes.forEach((e, k) => {
          add('eye', `Auge ${k === 0 ? 'links' : 'rechts'}${suffix}`, px(e), faceWidth * 0.22);
        });
        const center = mean([vis(POSE_NOSE), ...POSE_MOUTH.map(vis), el, er]);
        if (center) add('face', `Gesichtsmitte${suffix}`, px(center), faceWidth * 0.75);
      }
    }
    const sl = vis(SHOULDER_L);
    const sr = vis(SHOULDER_R);
    if (sl && sr) {
      const shoulderWidth = dist(px(sl), px(sr));
      const mid = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 };
      const hips = mean([vis(HIP_L), vis(HIP_R)]);
      // Brust: ein Drittel von der Schultermitte Richtung Hüfte (sonst etwas unterhalb der Schultern)
      const down = hips
        ? { x: (hips.x - mid.x) / 3, y: (hips.y - mid.y) / 3 }
        : { x: 0, y: (shoulderWidth / height) * 0.25 };
      add('chest', `Brust${suffix}`, px({ x: mid.x + down.x, y: mid.y + down.y }), shoulderWidth * 0.55);
    }
    const handRadius = sl && sr ? dist(px(sl), px(sr)) * 0.3 : Math.min(width, height) * 0.06;
    const hands = [mean(HAND_L.map(vis)), mean(HAND_R.map(vis))]
      .filter((h): h is P => h !== null)
      .sort((a, b) => a.x - b.x);
    hands.forEach((h, k) => {
      add(
        'hand',
        `Hand ${hands.length > 1 ? (k === 0 ? 'links' : 'rechts') : ''}${suffix}`.replace('  ', ' ').trim(),
        px(h),
        handRadius,
      );
    });
  });
  // Punkte knapp außerhalb an den Rand setzen, weit außerhalb verwerfen
  const tx = width * OUTSIDE_TOLERANCE;
  const ty = height * OUTSIDE_TOLERANCE;
  return out
    .filter((p) => p.x >= -tx && p.y >= -ty && p.x <= width + tx && p.y <= height + ty)
    .map((p) => ({ ...p, x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) }));
}
