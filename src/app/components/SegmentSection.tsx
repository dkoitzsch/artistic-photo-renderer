// Inspektor-Abschnitt „Segmente“ (E3): benannte Bereiche des Originals einer Ebene – aus der Markierung (Smarte
// Auswahl per Klick, Pinsel) oder dem Vordergrund. Segmente dienen als Effekt-/Gruppenmasken und für „Stil je Bereich“.

import { useState } from 'react';
import { foregroundSegment } from '../../ml/segments';
import {
  deleteSegmentCommand,
  endGesture,
  renameSegmentCommand,
  saveSelectionAsSegmentCommand,
  selectSegmentCommand,
} from '../../state/commands';
import type { Layer } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { Section } from './LayerSections';

const hex = (c: [number, number, number]) =>
  `#${c
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export function SegmentSection({ layer }: { layer: Layer }) {
  const project = useProject();
  const busy = useAppStore((s) => s.tasks.length > 0);
  const setTool = useAppStore((s) => s.setTool);
  const [name, setName] = useState('Person');
  const segments = (project?.segments ?? []).filter((s) => s.originalId === layer.originalId);
  return (
    <Section title="Segmente" testId="segment-section" defaultOpen={segments.length > 0 || !!layer.selection}>
      <p className="section-note">
        Bereiche des Bildes für Effektmasken und „Stil je Bereich“. Per Klick: Smarte Auswahl (W), dann hier
        speichern.
      </p>
      {segments.map((s) => (
        <div className="segment-row" key={s.id} data-testid="segment-row">
          <span className="segment-swatch" style={{ background: hex(s.color) }} />
          <input
            className="text-input"
            aria-label="Name des Segments"
            value={s.name}
            onChange={(e) => {
              renameSegmentCommand(s.id, e.target.value);
            }}
            onBlur={endGesture}
          />
          <button
            className="button small"
            title="Als Markierung der Ebene laden (z. B. zum Hervorheben)"
            onClick={() => {
              selectSegmentCommand(layer.id, s.id);
              setTool('brush');
            }}
          >
            Markieren
          </button>
          <button
            className="button small"
            title="Segment löschen"
            onClick={() => {
              deleteSegmentCommand(s.id);
            }}
          >
            Löschen
          </button>
        </div>
      ))}
      <div className="segment-row">
        <input
          className="text-input"
          aria-label="Name für neues Segment"
          data-testid="segment-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <button
          className="button small primary"
          data-testid="segment-save"
          disabled={!layer.selection || !name.trim()}
          title="Aktuelle Markierung als Segment speichern"
          onClick={() => {
            saveSelectionAsSegmentCommand(layer.id, name.trim());
          }}
        >
          Markierung speichern
        </button>
      </div>
      <div className="button-row">
        <button
          className="button small"
          data-testid="segment-foreground"
          disabled={busy}
          onClick={() => void foregroundSegment(layer.id)}
        >
          Vordergrund als Segment
        </button>
      </div>
    </Section>
  );
}
