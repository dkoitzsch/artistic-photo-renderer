import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/malplan/analysis';
import { buildPlan, stepMasks } from '../../src/malplan/plan';
import { guideFromFlow, linearImage } from '../../src/malplan/strokeGuide';

/** Testbild: dunkler Himmel oben, heller Boden unten, kleine helle und dunkle Flecken */
function scene(w = 240, h = 180): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = y < h / 2 ? [40, 50, 90] : [220, 200, 160];
      if (Math.hypot(x - 60, y - 40) < 4) c = [250, 250, 245]; // kleines Licht
      if (Math.hypot(x - 180, y - 140) < 4) c = [15, 12, 10]; // kleiner dunkler Akzent
      if (x > 120 && x < 200 && y > 20 && y < 70) c = [110, 120, 150]; // mittlere Fläche
      out[i] = c[0] ?? 0;
      out[i + 1] = c[1] ?? 0;
      out[i + 2] = c[2] ?? 0;
      out[i + 3] = 255;
    }
  return out;
}

describe('Schichtplan', () => {
  const a = analyze(scene(), 240, 180, { shapes: 200, colors: 8 });
  const stepAt = (plan: ReturnType<typeof buildPlan>, x: number, y: number) =>
    plan.regionStep[a.labels[y * 240 + x] ?? 0];

  it('Öl/Acryl: Untermalung zuerst, dunkle große Flächen vor hellen, kleine Lichter zuletzt', () => {
    const plan = buildPlan(a, 'acrylic');
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0]?.kind).toBe('underpainting');
    const sky = stepAt(plan, 20, 80) ?? -1;
    const ground = stepAt(plan, 20, 160) ?? -1;
    const light = stepAt(plan, 60, 40) ?? -1;
    expect(sky).toBeLessThan(ground);
    expect(light).toBe(plan.steps.length - 1);
  });

  it('Aquarell: hell vor dunkel, Vorzeichnung zuerst', () => {
    const plan = buildPlan(a, 'watercolor');
    expect(plan.steps[0]?.kind).toBe('contour');
    const sky = stepAt(plan, 20, 80) ?? -1;
    const ground = stepAt(plan, 20, 160) ?? -1;
    expect(ground).toBeLessThan(sky);
    // kleiner dunkler Akzent kommt zuletzt
    expect(stepAt(plan, 180, 140)).toBe(plan.steps.length - 1);
  });

  it('Bleistift: Umrisse, dann Massen, 5 Schritte', () => {
    const plan = buildPlan(a, 'pencil');
    expect(plan.steps.map((s) => s.kind)).toEqual(['contour', 'paint', 'paint', 'paint', 'paint']);
  });

  it('Schritte kumulieren', () => {
    const plan = buildPlan(a, 'oil');
    const last = stepMasks(plan, plan.steps.length - 1);
    const first = stepMasks(plan, 1);
    const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
    expect(count(last.done)).toBeGreaterThanOrEqual(count(first.done));
    expect(count(last.done)).toBe(plan.regionStep.filter((s) => s >= 0).length);
  });
});

describe('Strichführung aus dem Richtungsfeld', () => {
  it('Pfeile in drei Pinselgruppen, Richtung entlang horizontaler Kanten', () => {
    const rgba = scene();
    const a = analyze(rgba, 240, 180, { shapes: 200, colors: 8 });
    const guide = guideFromFlow(a, linearImage(rgba, 240, 180));
    expect(guide.source).toBe('flow');
    expect(guide.widths).toHaveLength(3);
    expect(guide.widths[0] ?? 0).toBeGreaterThan(guide.widths[2] ?? 0);
    expect(guide.strokes.length).toBeGreaterThan(10);
    // nahe der Horizontlinie (y = 90) verlaufen die Pfeile waagerecht
    const near = guide.strokes.filter((s) => Math.abs((s.points[1] ?? 0) + (s.points[3] ?? 0) - 180) < 8);
    for (const s of near) {
      const dx = Math.abs((s.points[2] ?? 0) - (s.points[0] ?? 0));
      const dy = Math.abs((s.points[3] ?? 0) - (s.points[1] ?? 0));
      expect(dx).toBeGreaterThan(dy);
    }
  });
});
