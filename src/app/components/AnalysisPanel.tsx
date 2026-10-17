// Ansicht „Karten“: Analysekarte der ausgewählten Ebene (Helligkeit, Kanten) als Überlagerung mit Deckkraft.

import { useAppStore } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';

export function AnalysisPanel() {
  const viewMode = useAppStore((s) => s.viewMode);
  const view = useAppStore((s) => s.analysisView);
  const set = useAppStore((s) => s.setAnalysisView);
  if (viewMode !== 'analysis') return null;
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
        ]}
        onChange={(v) => {
          set({ map: v as 'luminance' | 'edges' | 'flow' });
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
        {view.map === 'edges'
          ? 'Helligkeit = Kantenstärke, Farbe = Kantenrichtung.'
          : view.map === 'flow'
            ? 'Farbe = Strichrichtung (folgt Kanten, in Flächen großräumig), Helligkeit = Eindeutigkeit.'
            : 'Wahrgenommene Helligkeit des Originals der Ebene.'}
      </p>
    </div>
  );
}
