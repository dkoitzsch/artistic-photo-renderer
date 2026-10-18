// Aktionen mit der Markierung (Basis-Spec g): Hervorheben (neue Ebene darüber, optional Lochfüllung in der Quelle)
// und Extrahieren (die Ebene behält nur den markierten Bereich).

import { useState } from 'react';
import { extractSelectionCommand, highlightSelectionCommand } from '../../state/commands';
import type { Layer } from '../../state/project';
import { useAppStore } from '../../state/store';
import { Toggle } from '../controls/Toggle';

export function SelectionActions({ layer }: { layer: Layer }) {
  const [fillHole, setFillHole] = useState(false);
  const setTool = useAppStore((s) => s.setTool);
  if (!layer.selection) return null;
  return (
    <div className="selection-actions" data-testid="selection-actions">
      <span className="parallax-title">Mit der Markierung</span>
      <Toggle label="Lochfüllung in der Quelle" value={fillHole} onChange={setFillHole} />
      <div className="button-row">
        <button
          className="button small primary"
          data-testid="highlight"
          title="Markierten Bereich als neue Ebene über die Quelle legen"
          onClick={() => {
            if (highlightSelectionCommand(layer.id, fillHole)) setTool('move');
          }}
        >
          Hervorheben
        </button>
        <button
          className="button small"
          data-testid="extract"
          title="Ebene behält nur den markierten Bereich"
          onClick={() => {
            extractSelectionCommand(layer.id);
            setTool('move');
          }}
        >
          Extrahieren
        </button>
      </div>
    </div>
  );
}
