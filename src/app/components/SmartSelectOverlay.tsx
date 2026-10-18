// Werkzeug „Smarte Auswahl“ (Basis-Spec g): Klick auf ein Objekt = gehört dazu, Alt-Klick = gehört nicht dazu.
// Die Klicks liegen in Ebenen-px an der Markierung; SAM rechnet im ML-Worker. Danach mit dem Pinsel verfeinern.

import { useState, type PointerEvent } from 'react';
import { smartSelectClick } from '../../ml/smartSelect';
import { useAppStore, useProject } from '../../state/store';
import { apply, invert, placement } from '../../state/transform';
import { paintLayerOf } from './BrushOverlay';

export function SmartSelectOverlay() {
  const project = useProject();
  const tool = useAppStore((s) => s.tool);
  const view = useAppStore((s) => s.view);
  const selected = useAppStore((s) => s.selectedNodeId);
  const comparing = useAppStore((s) => s.compareSplit !== null);
  const [busy, setBusy] = useState(false);
  if (tool !== 'smart' || !project || comparing) return null;
  const layer = paintLayerOf(project, selected);
  if (!layer) return null;
  const original = project.originals[layer.originalId];
  if (!original) return null;
  const toCanvas = placement(layer.transform, original, project.canvas);
  const toLayer = invert(toCanvas);
  const clicks = layer.selection?.clicks ?? [];

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || busy) return;
    const r = e.currentTarget.getBoundingClientRect();
    const [x, y] = apply(
      toLayer,
      (e.clientX - r.left - view.offsetX) / view.zoom,
      (e.clientY - r.top - view.offsetY) / view.zoom,
    );
    if (x < 0 || y < 0 || x > original.width || y > original.height) return;
    setBusy(true);
    // ⇧-Klick beginnt ein neues Objekt
    void smartSelectClick(layer.id, x, y, !e.altKey, e.shiftKey).finally(() => {
      setBusy(false);
    });
  };

  const marks: { x: number; y: number; positive: boolean }[] = [];
  for (let i = 0; i < clicks.length; i += 3) {
    const [cx, cy] = apply(toCanvas, clicks[i] ?? 0, clicks[i + 1] ?? 0);
    marks.push({
      x: cx * view.zoom + view.offsetX,
      y: cy * view.zoom + view.offsetY,
      positive: clicks[i + 2] === 1,
    });
  }
  return (
    <div
      className={`smart-overlay${busy ? ' busy' : ''}`}
      data-testid="smart-overlay"
      data-busy={busy ? '1' : '0'}
      onPointerDown={onDown}
    >
      {marks.map((m, i) => (
        <span
          key={i}
          className={`smart-mark ${m.positive ? 'positive' : 'negative'}`}
          style={{ left: m.x, top: m.y }}
        >
          {m.positive ? '+' : '−'}
        </span>
      ))}
    </div>
  );
}
