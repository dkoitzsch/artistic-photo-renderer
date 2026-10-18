// Pinsel auf der Leinwand (Basis-Spec g): malt auf Markierung, Maske oder Fokuskarte der gewählten Ebene.
// Zeigerposition → Ebenen-px (Transformation der Ebene), Glättung, Stiftdruck über Pointer Events,
// Alt schaltet zwischen Hinzufügen und Entfernen. Ein Zug = ein History-Eintrag.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { smoothPoint } from '../../brush/dabs';
import { beginStroke, paintStrokeCommand } from '../../state/commands';
import { findNode, firstLayer, type BrushStroke, type Layer, type Project } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { apply, invert, placement } from '../../state/transform';

/** Ebene, auf der gemalt wird: die gewählte Ebene, sonst die erste. */
export function paintLayerOf(project: Project, selectedId: string | null): Layer | null {
  const node = selectedId ? findNode(project.root, selectedId) : undefined;
  if (node?.kind === 'layer') return node;
  return firstLayer(project) ?? null;
}

type Active = {
  id: number;
  layerId: string;
  target: 'selection' | 'mask' | 'focus';
  stroke: BrushStroke;
  last: [number, number] | null;
  raf: number | null;
};

export function BrushOverlay() {
  const project = useProject();
  const tool = useAppStore((s) => s.tool);
  const brush = useAppStore((s) => s.brush);
  const view = useAppStore((s) => s.view);
  const selected = useAppStore((s) => s.selectedNodeId);
  const comparing = useAppStore((s) => s.compareSplit !== null);
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<Active | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [alt, setAlt] = useState(false);
  const [space, setSpace] = useState(false);

  // Alt (Gegenmodus) und Leertaste (Hand) verfolgen
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(true);
      if (e.code === 'Space') setSpace(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(false);
      if (e.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setAlt(false);
      setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Mausrad an die Leinwand weitergeben (Zoom/Verschieben bleiben möglich)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const canvas = el.parentElement?.querySelector('canvas');
      canvas?.dispatchEvent(new WheelEvent('wheel', e));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  });

  if (tool !== 'brush' || !project || comparing) return null;
  const layer = paintLayerOf(project, selected);
  if (!layer) return null;
  const original = project.originals[layer.originalId];
  if (!original) return null;
  const toLayer = invert(placement(layer.transform, original, project.canvas));
  const layerScale = Math.abs(layer.transform.scale) || 1;

  const local = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toLayerPx = (sx: number, sy: number): [number, number] =>
    apply(toLayer, (sx - view.offsetX) / view.zoom, (sy - view.offsetY) / view.zoom);
  const pressureOf = (e: PointerEvent<HTMLDivElement>) =>
    e.pointerType === 'mouse' ? 1 : Math.max(0.05, e.pressure || 0.5);

  const flush = (gesture: boolean) => {
    const a = active.current;
    if (!a) return;
    a.raf = null;
    paintStrokeCommand(a.layerId, a.target, { ...a.stroke, points: [...a.stroke.points] }, a.id, gesture);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode = e.altKey ? (brush.mode === 'add' ? 'remove' : 'add') : brush.mode;
    const [sx, sy] = local(e);
    const [x, y] = toLayerPx(sx, sy);
    active.current = {
      id: beginStroke(),
      layerId: layer.id,
      target: brush.target,
      stroke: {
        mode,
        size: Math.max(0.5, brush.size / layerScale),
        softness: brush.softness,
        flow: brush.flow,
        pressure: brush.pressure,
        points: [x, y, pressureOf(e)],
      },
      last: [sx, sy],
      raf: null,
    };
    flush(true);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const pos = local(e);
    setCursor(pos);
    const a = active.current;
    if (!a) return;
    // zusammengefasste Ereignisse (Stift, hohe Abtastrate) für glatte Striche
    const events = e.nativeEvent.getCoalescedEvents();
    const list = events.length ? events : [e.nativeEvent];
    const r = e.currentTarget.getBoundingClientRect();
    for (const ev of list) {
      const p = smoothPoint(a.last, [ev.clientX - r.left, ev.clientY - r.top], brush.smoothing);
      a.last = p;
      const [x, y] = toLayerPx(p[0], p[1]);
      a.stroke.points.push(x, y, ev.pointerType === 'mouse' ? 1 : Math.max(0.05, ev.pressure || 0.5));
    }
    a.raf ??= requestAnimationFrame(() => {
      flush(true);
    });
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const a = active.current;
    if (!a) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (a.raf !== null) cancelAnimationFrame(a.raf);
    flush(false);
    active.current = null;
  };

  const diameter = brush.size * view.zoom;
  const mode = alt ? (brush.mode === 'add' ? 'remove' : 'add') : brush.mode;
  return (
    <div
      ref={ref}
      className="brush-overlay"
      style={{ pointerEvents: space ? 'none' : 'auto' }}
      data-testid="brush-overlay"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => {
        if (!active.current) setCursor(null);
      }}
    >
      {cursor && (
        <div
          className={`brush-cursor ${mode}`}
          style={{
            left: cursor[0] - diameter / 2,
            top: cursor[1] - diameter / 2,
            width: diameter,
            height: diameter,
          }}
        >
          <div className="brush-cursor-core" style={{ inset: `${(brush.softness * diameter) / 4}px` }} />
        </div>
      )}
    </div>
  );
}
