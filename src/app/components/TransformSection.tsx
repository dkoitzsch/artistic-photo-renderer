// Inspektor-Abschnitt „Transformieren“ (Spec f): Lage, Skalierung, Drehung, Spiegeln, Füllen/Einpassen.

import { endGesture, setTransformCommand } from '../../state/commands';
import type { Layer, Project } from '../../state/project';
import {
  fillTransform,
  fitTransform,
  IDENTITY_TRANSFORM,
  isIdentity,
  normalizeAngle,
} from '../../state/transform';
import { Slider } from '../controls/Slider';
import { Section } from './LayerSections';

export function TransformSection({ layer, project }: { layer: Layer; project: Project }) {
  const t = layer.transform;
  const original = project.originals[layer.originalId];
  const { width: cw, height: ch } = project.canvas;
  if (!original) return null;
  const set = (patch: Partial<Layer['transform']>, gesture = false) => {
    setTransformCommand(layer.id, patch, gesture);
  };
  return (
    <Section title="Transformieren" testId="transform-section" defaultOpen={!isIdentity(t)}>
      {layer.locked && <p className="section-note">Die Ebene ist gesperrt.</p>}
      <Slider
        label="Position X"
        value={Math.round(t.x)}
        min={-cw}
        max={cw}
        defaultValue={0}
        step={1}
        unit="px"
        onChange={(v, g) => {
          set({ x: v }, g);
        }}
        onGestureEnd={endGesture}
        testId="transform-x"
      />
      <Slider
        label="Position Y"
        value={Math.round(t.y)}
        min={-ch}
        max={ch}
        defaultValue={0}
        step={1}
        unit="px"
        onChange={(v, g) => {
          set({ y: v }, g);
        }}
        onGestureEnd={endGesture}
        testId="transform-y"
      />
      <Slider
        label="Skalierung"
        value={Math.round(t.scale * 1000) / 10}
        min={1}
        max={800}
        defaultValue={100}
        step={0.1}
        unit="%"
        scale="log"
        onChange={(v, g) => {
          set({ scale: v / 100 }, g);
        }}
        onGestureEnd={endGesture}
        testId="transform-scale"
      />
      <Slider
        label="Drehung"
        value={Math.round(normalizeAngle(t.rotation) * 10) / 10}
        min={-180}
        max={180}
        defaultValue={0}
        step={0.1}
        unit="°"
        onChange={(v, g) => {
          set({ rotation: v }, g);
        }}
        onGestureEnd={endGesture}
        testId="transform-rotation"
      />
      <div className="button-row">
        <button
          className={`button small${t.flipX ? ' active' : ''}`}
          aria-pressed={!!t.flipX}
          onClick={() => {
            set({ flipX: !t.flipX });
          }}
          data-testid="transform-flip-x"
          title="Horizontal spiegeln"
        >
          ↔ Spiegeln
        </button>
        <button
          className={`button small${t.flipY ? ' active' : ''}`}
          aria-pressed={!!t.flipY}
          onClick={() => {
            set({ flipY: !t.flipY });
          }}
          data-testid="transform-flip-y"
          title="Vertikal spiegeln"
        >
          ↕ Spiegeln
        </button>
      </div>
      <div className="button-row">
        <button
          className="button small"
          onClick={() => {
            set(fillTransform(t, original, project.canvas));
          }}
          data-testid="transform-fill"
          title="Skalieren und zentrieren, bis das Bild die ganze Leinwand bedeckt"
        >
          Leinwand füllen
        </button>
        <button
          className="button small"
          onClick={() => {
            set(fitTransform(t, original, project.canvas));
          }}
          data-testid="transform-fit"
          title="Skalieren und zentrieren, bis das ganze Bild sichtbar ist"
        >
          Einpassen
        </button>
        <button
          className="button small"
          disabled={isIdentity(t)}
          onClick={() => {
            set({ ...IDENTITY_TRANSFORM, flipX: false, flipY: false });
          }}
          data-testid="transform-reset"
          title="Ursprüngliche Lage und Größe (1 Bild-px = 1 Leinwand-px)"
        >
          Zurücksetzen
        </button>
      </div>
    </Section>
  );
}
