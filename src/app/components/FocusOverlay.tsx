// Fokuspunkt-Werkzeug: Punkte der gewählten Ebene als Kreise über der Leinwand.
// Ziehen = verschieben, Ziehen am Rand = Radius, Klick ins Leere = neuen Punkt setzen,
// × am Punkt oder Entf/Rücktaste (ausgewählter Punkt) = entfernen.
// Bei aktivem Vorher/Nachher-Teiler sind die Punkte nur sichtbar, nicht greifbar.

import { useEffect, useState, type PointerEvent } from 'react';
import {
  addFocusPointCommand,
  endGesture,
  removeFocusPointCommand,
  updateFocusPointCommand,
} from '../../state/commands';
import { findNode, newId, type Layer } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';

type Drag = { pointId: string; mode: 'move' | 'radius'; dx: number; dy: number };

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function FocusOverlay() {
  const project = useProject();
  const selected = useAppStore((s) => s.selectedNodeId);
  const view = useAppStore((s) => s.view);
  const tool = useAppStore((s) => s.tool);
  const viewMode = useAppStore((s) => s.viewMode);
  const comparing = useAppStore((s) => s.compareSplit !== null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [activePoint, setActivePoint] = useState<string | null>(null);

  const node = project && selected ? findNode(project.root, selected) : undefined;
  const layer: Layer | undefined = node?.kind === 'layer' ? node : undefined;
  const visible = tool === 'focus' || viewMode === 'focus';
  // Greifbar nur mit dem Fokuspunkt-Werkzeug und ohne Vorher/Nachher-Teiler
  const interactive = tool === 'focus' && !comparing;
  const points = layer?.focusMap?.points ?? [];
  const layerId = layer?.id;

  // Entf/Rücktaste entfernt den zuletzt angefassten Punkt
  useEffect(() => {
    if (!interactive || !activePoint || !layerId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable(e.target)) {
        e.preventDefault();
        removeFocusPointCommand(layerId, activePoint);
        setActivePoint(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [interactive, activePoint, layerId]);

  if (!project || !layer || !visible) return null;

  const svgOf = (e: PointerEvent<SVGElement>): SVGSVGElement | null =>
    e.currentTarget instanceof SVGSVGElement ? e.currentTarget : e.currentTarget.ownerSVGElement;
  const toCanvas = (e: PointerEvent<SVGElement>) => {
    const r = svgOf(e)?.getBoundingClientRect();
    const sx = e.clientX - (r?.left ?? 0);
    const sy = e.clientY - (r?.top ?? 0);
    return { x: (sx - view.offsetX) / view.zoom, y: (sy - view.offsetY) / view.zoom };
  };

  const onBackgroundDown = (e: PointerEvent<SVGRectElement>) => {
    if (!interactive || e.button !== 0) return;
    const { x, y } = toCanvas(e);
    if (x < 0 || y < 0 || x > project.canvas.width || y > project.canvas.height) {
      setActivePoint(null);
      return;
    }
    const id = newId();
    addFocusPointCommand(layer.id, {
      id,
      kind: 'custom',
      label: `Punkt ${points.filter((p) => p.kind === 'custom').length + 1}`,
      x: Math.round(x),
      y: Math.round(y),
      radius: Math.round(Math.max(project.canvas.width, project.canvas.height) * 0.08),
      enabled: true,
    });
    setActivePoint(id);
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const { x, y } = toCanvas(e);
    const pt = points.find((p) => p.id === drag.pointId);
    if (!pt) return;
    if (drag.mode === 'move') {
      updateFocusPointCommand(
        layer.id,
        pt.id,
        { x: Math.round(x - drag.dx), y: Math.round(y - drag.dy) },
        true,
      );
    } else {
      updateFocusPointCommand(
        layer.id,
        pt.id,
        { radius: Math.max(4, Math.round(Math.hypot(x - pt.x, y - pt.y))) },
        true,
      );
    }
  };

  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
    endGesture();
  };

  return (
    <svg
      className={`focus-overlay${interactive ? ' active' : ''}`}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-testid="focus-overlay"
    >
      {interactive && (
        <rect className="focus-hit" x="0" y="0" width="100%" height="100%" onPointerDown={onBackgroundDown} />
      )}
      {points.map((p) => {
        const cx = p.x * view.zoom + view.offsetX;
        const cy = p.y * view.zoom + view.offsetY;
        const r = p.radius * view.zoom;
        const start = (mode: Drag['mode']) => (e: PointerEvent<SVGElement>) => {
          if (!interactive || e.button !== 0) return;
          e.stopPropagation();
          svgOf(e)?.setPointerCapture(e.pointerId);
          const c = toCanvas(e);
          setActivePoint(p.id);
          setDrag({ pointId: p.id, mode, dx: c.x - p.x, dy: c.y - p.y });
        };
        return (
          <g
            key={p.id}
            className={`focus-point${p.enabled ? '' : ' off'}${activePoint === p.id && interactive ? ' selected' : ''}`}
            data-testid="focus-point"
          >
            <circle className="focus-ring" cx={cx} cy={cy} r={r} onPointerDown={start('radius')} />
            <circle className="focus-center" cx={cx} cy={cy} r={6} onPointerDown={start('move')} />
            <text className="focus-label" x={cx + 9} y={cy - 9}>
              {p.label}
            </text>
            {interactive && (
              <g
                className="focus-remove"
                role="button"
                aria-label={`${p.label} entfernen`}
                data-testid="focus-remove"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  removeFocusPointCommand(layer.id, p.id);
                  if (activePoint === p.id) setActivePoint(null);
                }}
              >
                <title>Fokuspunkt entfernen (oder Punkt anfassen und Entf drücken)</title>
                <circle cx={cx - 14} cy={cy - 14} r={8} />
                <path d={`M${cx - 17} ${cy - 17}l6 6m0 -6l-6 6`} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
