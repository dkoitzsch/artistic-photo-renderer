// Malplan: Schichtplan (Schritte wählen, Beschreibung) und Strichführung (Legende mit Pinselbreiten in mm)
// – Spec „Effekte“ 7.6.

import type { MalplanSettings } from '../../malplan/model';
import { GUIDE_COLORS, NEW_COLOR } from '../../malplan/render';
import { useMalplanStore } from '../../malplan/store';
import { useAppStore } from '../../state/store';
import { Section } from './LayerSections';

export function StepsSection() {
  const plan = useMalplanStore((s) => s.plan);
  const step = useAppStore((s) => s.malplanStep);
  const setStep = useAppStore((s) => s.setMalplanStep);
  if (!plan) return <p className="section-note">Schichtplan wird berechnet …</p>;
  const current = Math.min(step, plan.steps.length - 1);
  return (
    <Section title={`Schichtplan (${plan.steps.length} Schritte)`} testId="malplan-steps">
      <p className="section-note">
        Jeder Schritt zeigt den Stand; neu hinzukommende Flächen sind{' '}
        <span style={{ color: `rgb(${NEW_COLOR.join(',')})`, fontWeight: 600 }}>umrandet</span>.
      </p>
      <ol className="step-list" data-testid="step-list">
        {plan.steps.map((st, i) => (
          <li key={i}>
            <button
              className={`step${i === current ? ' active' : ''}`}
              aria-pressed={i === current}
              data-testid={`step-${i}`}
              onClick={() => {
                setStep(i);
              }}
            >
              <span className="step-number">{i + 1}</span>
              <span className="step-text">
                <strong>{st.title}</strong>
                <span>{st.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Pinselbreite in mm auf dem Untergrund */
export function brushMm(widthPx: number, analysisWidth: number, s: MalplanSettings): number {
  return (widthPx * s.format.widthCm * 10) / Math.max(1, analysisWidth);
}

export function StrokesSection({ settings }: { settings: MalplanSettings }) {
  const guide = useMalplanStore((s) => s.guide);
  const width = useMalplanStore((s) => s.result?.width ?? 1);
  if (!guide) return <p className="section-note">Strichführung wird berechnet …</p>;
  const names =
    guide.source === 'stroke-paint'
      ? guide.widths.map((_, i) => `Durchgang ${i + 1}`)
      : ['große Flächen', 'mittlere Formen', 'Details'];
  return (
    <Section title="Strichführung" testId="malplan-strokes">
      <p className="section-note" data-testid="guide-source">
        {guide.source === 'stroke-paint'
          ? `Aus den Strichdaten des Effekts „Pinselstriche“ (${guide.strokes.length} Striche).`
          : 'Richtung aus dem Richtungsfeld des Bildes; Pinselbreite nach Flächengröße.'}
      </p>
      <ul className="guide-legend" data-testid="guide-legend">
        {guide.widths.map((w, i) => (
          <li key={i}>
            <span
              className="guide-key"
              style={{ background: `rgb(${(GUIDE_COLORS[i % GUIDE_COLORS.length] ?? [0, 0, 0]).join(',')})` }}
            />
            {names[i] ?? `Gruppe ${i + 1}`}: Pinsel ca. {Math.max(1, Math.round(brushMm(w, width, settings)))}{' '}
            mm
          </li>
        ))}
      </ul>
    </Section>
  );
}
