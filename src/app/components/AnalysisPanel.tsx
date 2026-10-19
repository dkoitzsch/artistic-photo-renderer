// Ansicht „Karten“: Analysekarte der ausgewählten Ebene (Helligkeit, Kanten, Richtungsfeld, Normalen, Salienz,
// Gesichter, Segmente) als Überlagerung mit Deckkraft. Karten aus Modellen werden beim Auswählen berechnet.

import { useEffect } from 'react';
import { requestViewMap } from '../../ml/analysis';
import { useAppStore, useProject } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';
import type { AnalysisView } from '../../state/store';

const NOTES: Record<AnalysisView['map'], string> = {
  luminance: 'Wahrgenommene Helligkeit des Originals der Ebene.',
  edges: 'Helligkeit = Kantenstärke, Farbe = Kantenrichtung.',
  flow: 'Farbe = Strichrichtung (folgt Kanten, in Flächen großräumig), Helligkeit = Eindeutigkeit.',
  normals:
    'Oberflächenrichtung aus der Tiefenkarte: rot = nach rechts, grün = nach unten, blau = zum Betrachter.',
  saliency: 'Hell = zieht den Blick an (U²-Net-p).',
  faces: 'Erkannte Gesichtsflächen (MediaPipe).',
  segments: 'Gespeicherte Segmente des Originals in ihren Farben.',
};

export function AnalysisPanel() {
  const viewMode = useAppStore((s) => s.viewMode);
  const view = useAppStore((s) => s.analysisView);
  const set = useAppStore((s) => s.setAnalysisView);
  const selected = useAppStore((s) => s.selectedNodeId);
  const project = useProject();
  const active = viewMode === 'analysis';
  const map = view.map;
  useEffect(() => {
    if (!active || !selected) return;
    if (map === 'normals' || map === 'saliency' || map === 'faces') {
      requestViewMap({ layerId: selected, map: map === 'normals' ? 'depth' : map });
      return () => {
        requestViewMap(null);
      };
    }
    return undefined;
  }, [active, selected, map]);
  if (!active) return null;
  const faceCount = (() => {
    if (!project || !selected || map !== 'faces') return null;
    for (const maps of Object.values(project.analysis ?? {})) if (maps.faces) return maps.faces.faceCount;
    return null;
  })();
  return (
    <div className="parallax-panel analysis-panel" data-testid="analysis-panel">
      <span className="parallax-title">Analysekarte</span>
      <EnumControl
        label="Karte"
        value={view.map}
        options={[
          { value: 'luminance', label: 'Helligkeit' },
          { value: 'edges', label: 'Kanten' },
          { value: 'flow', label: 'Richtungsfeld' },
          { value: 'normals', label: 'Normalen' },
          { value: 'saliency', label: 'Salienz' },
          { value: 'faces', label: 'Gesichter' },
          { value: 'segments', label: 'Segmente' },
        ]}
        onChange={(v) => {
          set({ map: v as AnalysisView['map'] });
        }}
      />
      <Slider
        label="Deckkraft"
        value={Math.round(view.opacity * 100)}
        min={0}
        max={100}
        defaultValue={85}
        step={1}
        unit="%"
        onChange={(v) => {
          set({ opacity: v / 100 });
        }}
        testId="analysis-opacity"
      />
      <p className="section-note">
        {NOTES[view.map]}
        {faceCount !== null ? ` ${faceCount} Gesicht${faceCount === 1 ? '' : 'er'} erkannt.` : ''}
      </p>
    </div>
  );
}
