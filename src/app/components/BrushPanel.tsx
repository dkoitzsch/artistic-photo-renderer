// Optionen des Pinsels (Basis-Spec g) als schwebende Leiste über der Leinwand: Ziel, Modus, Größe, Weichheit, Fluss,
// Glättung, Stiftdruck, Farbschleier; Aktionen für die Markierung.

import { clearPaintCommand, selectAllCommand } from '../../state/commands';
import { useAppStore, useProject } from '../../state/store';
import { ColorControl } from '../controls/ColorControl';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';
import { Toggle } from '../controls/Toggle';
import { paintLayerOf } from './BrushOverlay';
import { SelectionActions } from './SelectionActions';

export function BrushPanel() {
  const project = useProject();
  const tool = useAppStore((s) => s.tool);
  const brush = useAppStore((s) => s.brush);
  const setBrush = useAppStore((s) => s.setBrush);
  const selected = useAppStore((s) => s.selectedNodeId);
  if ((tool !== 'brush' && tool !== 'smart') || !project) return null;
  const layer = paintLayerOf(project, selected);
  const focus = brush.target === 'focus';
  return (
    <div className="parallax-panel brush-panel" data-testid="brush-panel">
      <span className="parallax-title">
        {tool === 'smart' ? 'Smarte Auswahl' : 'Pinsel'}
        {layer ? ` · ${layer.name}` : ''}
      </span>
      {tool === 'brush' && (
        <>
          <EnumControl
            label="Malen auf"
            value={brush.target}
            options={[
              { value: 'selection', label: 'Markierung' },
              { value: 'mask', label: 'Maske' },
              { value: 'focus', label: 'Fokuskarte' },
            ]}
            onChange={(v) => {
              setBrush({ target: v as typeof brush.target });
            }}
          />
          <EnumControl
            label="Modus (Alt)"
            value={brush.mode}
            options={[
              { value: 'add', label: focus ? 'Schärfer' : 'Hinzufügen' },
              { value: 'remove', label: focus ? 'Unschärfer' : 'Entfernen' },
            ]}
            onChange={(v) => {
              setBrush({ mode: v as 'add' | 'remove' });
            }}
          />
          <Slider
            label="Größe"
            hint="Tastatur [ und ]"
            value={brush.size}
            min={1}
            max={800}
            defaultValue={60}
            step={1}
            unit="px"
            scale="log"
            onChange={(v) => {
              setBrush({ size: v });
            }}
            testId="brush-size"
          />
          <Slider
            label="Kantenweichheit"
            value={Math.round(brush.softness * 100)}
            min={0}
            max={100}
            defaultValue={50}
            step={1}
            unit="%"
            onChange={(v) => {
              setBrush({ softness: v / 100 });
            }}
            testId="brush-softness"
          />
          <Slider
            label="Fluss"
            hint="Aufbau bei mehrfachem Malen"
            value={Math.round(brush.flow * 100)}
            min={1}
            max={100}
            defaultValue={80}
            step={1}
            unit="%"
            onChange={(v) => {
              setBrush({ flow: v / 100 });
            }}
            testId="brush-flow"
          />
          <Slider
            label="Glättung"
            value={Math.round(brush.smoothing * 100)}
            min={0}
            max={100}
            defaultValue={30}
            step={1}
            unit="%"
            onChange={(v) => {
              setBrush({ smoothing: v / 100 });
            }}
          />
          <Toggle
            label="Stiftdruck"
            value={brush.pressure}
            onChange={(v) => {
              setBrush({ pressure: v });
            }}
          />
        </>
      )}
      {(brush.target === 'selection' || tool === 'smart') && (
        <>
          <ColorControl
            label="Schleier"
            value={brush.veilColor}
            onChange={(c) => {
              setBrush({ veilColor: c });
            }}
          />
          <Slider
            label="Deckkraft Schleier"
            value={Math.round(brush.veilOpacity * 100)}
            min={10}
            max={90}
            defaultValue={40}
            step={1}
            unit="%"
            onChange={(v) => {
              setBrush({ veilOpacity: v / 100 });
            }}
          />
        </>
      )}
      {layer && (
        <div className="button-row">
          {brush.target === 'selection' || tool === 'smart' ? (
            <>
              <button
                className="button small"
                data-testid="select-all"
                onClick={() => {
                  selectAllCommand(layer.id);
                }}
              >
                Alles markieren
              </button>
              <button
                className="button small"
                data-testid="selection-clear"
                disabled={!layer.selection}
                onClick={() => {
                  clearPaintCommand(layer.id, 'selection');
                }}
              >
                Markierung löschen
              </button>
            </>
          ) : (
            <button
              className="button small"
              data-testid="strokes-clear"
              disabled={
                brush.target === 'mask' ? !layer.maskStrokes?.length : !layer.focusMap?.strokes?.length
              }
              onClick={() => {
                clearPaintCommand(layer.id, brush.target);
              }}
            >
              Gemalte Striche entfernen
            </button>
          )}
        </div>
      )}
      {layer && <SelectionActions layer={layer} />}
    </div>
  );
}
