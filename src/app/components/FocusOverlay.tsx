// Fokuspunkt-Werkzeug: Punkte der gewählten Ebene als Kreise über der Leinwand.
// Ziehen = verschieben, Ziehen am Rand = Radius, Klick ins Leere = neuen Punkt setzen.

import { useState, type PointerEvent } from 'react';
import { addFocusPointCommand, endGesture, updateFocusPointCommand } from '../../state/commands';
import { findNode, newId, type Layer } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';

type Drag = { pointId: string; mode: 'move' | 'radius'; dx: number; dy: number };

export function FocusOverlay() {
  const project = useProject();
  const selected = useAppStore((s) => s.selectedNodeId);
  const view = useAppStore((s) => s.view);
  const tool = useAppStore((s) => s.tool);
  const viewMode = useAppStore((s) => s.viewMode);
  const [drag, setDrag] = useState<Drag | null>(null);

  const node = project && selected ? findNode(project.root, selected) : undefined;
  const layer: Layer | undefined = node?.kind === 'layer' ? node : undefined;
  const active = tool === 'focus';
  if (!project || !layer || (!active && viewMode !== 'focus')) return null;
  const points = layer.focusMap?.points ?? [];

  const svgOf = (e: PointerEvent<SVGElement>): SVGSVGElement | null =>
    e.currentTarget instanceof SVGSVGElement ? e.currentTarget : e.currentTarget.ownerSVGElement;
  const toCanvas = (e: PointerEvent<SVGElement>) => {
    const r = svgOf(e)?.getBoundingClientRect();
    const sx = e.clientX - (r?.left ?? 0);
    const sy = e.clientY - (r?.top ?? 0);
    return { x: (sx - view.offsetX) / view.zoom, y: (sy - view.offsetY) / view.zoom };
  };

  const onBackgroundDown = (e: PointerEvent<SVGRectElement>) => {
    if (!active || e.button !== 0) return;
    const { x, y } = toCanvas(e);
    if (x < 0 || y < 0 || x > project.canvas.width || y > project.canvas.height) return;
    addFocusPointCommand(layer.id, {
      id: newId(),
      kind: 'custom',
      label: `Punkt ${points.filter((p) => p.kind === 'custom').length + 1}`,
      x: Math.round(x),
      y: Math.round(y),
      radius: Math.round(Math.max(project.canvas.width, project.canvas.height) * 0.08),
      enabled: true,
    });
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
      className={`focus-overlay${active ? ' active' : ''}`}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-testid="focus-overlay"
    >
      {active && (
        <rect className="focus-hit" x="0" y="0" width="100%" height="100%" onPointerDown={onBackgroundDown} />
      )}
      {points.map((p) => {
        const cx = p.x * view.zoom + view.offsetX;
        const cy = p.y * view.zoom + view.offsetY;
        const r = p.radius * view.zoom;
        const start = (mode: Drag['mode']) => (e: PointerEvent<SVGElement>) => {
          if (!active || e.button !== 0) return;
          e.stopPropagation();
          svgOf(e)?.setPointerCapture(e.pointerId);
          const c = toCanvas(e);
          setDrag({ pointId: p.id, mode, dx: c.x - p.x, dy: c.y - p.y });
        };
        return (
          <g key={p.id} className={`focus-point${p.enabled ? '' : ' off'}`} data-testid="focus-point">
            <circle className="focus-ring" cx={cx} cy={cy} r={r} onPointerDown={start('radius')} />
            <circle className="focus-center" cx={cx} cy={cy} r={6} onPointerDown={start('move')} />
            <text className="focus-label" x={cx + 9} y={cy - 9}>
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
