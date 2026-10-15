// Transformationsrahmen der Auswahl (Werkzeug „Verschieben“, Spec f): Fläche ziehen = verschieben,
// Ecke ziehen = skalieren (um die Mitte), Griff oben = drehen (⇧: 15°-Schritte), Pfeiltasten = 1 px (⇧: 10 px).
// Gruppen: Rahmen um alle Ebenen, nur verschieben. Bei aktivem Vorher/Nachher-Teiler nicht greifbar.

import { useEffect, useState, type PointerEvent } from 'react';
import { endGesture, setTransformCommand, translateNodeCommand } from '../../state/commands';
import { findNode, walkLayers, type Layer, type Project, type Transform } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { corners } from '../../state/transform';

type Drag =
  | { mode: 'move'; last: [number, number] }
  | { mode: 'scale'; start: Transform; center: [number, number]; startDist: number }
  | { mode: 'rotate'; start: Transform; center: [number, number]; startAngle: number };

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))
  );
}

function layerCorners(project: Project, l: Layer): [number, number][] | null {
  const o = project.originals[l.originalId];
  return o ? corners(l.transform, o, project.canvas) : null;
}

export function TransformOverlay() {
  const project = useProject();
  const selected = useAppStore((s) => s.selectedNodeId);
  const view = useAppStore((s) => s.view);
  const tool = useAppStore((s) => s.tool);
  const comparing = useAppStore((s) => s.compareSplit !== null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const node =
    project && selected && selected !== project.root.id ? findNode(project.root, selected) : undefined;
  const active = tool === 'move' && !comparing && node !== undefined;
  const nodeId = node?.id;

  // Pfeiltasten verschieben die Auswahl
  useEffect(() => {
    if (!active || !nodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      const step = e.shiftKey ? 10 : 1;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      translateNodeCommand(nodeId, v[0], v[1], true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) endGesture();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [active, nodeId]);

  if (!project || !node || !active) return null;

  // Umriss: Ebene = gedrehtes Rechteck, Gruppe = umschließendes Rechteck aller Ebenen
  let pts: [number, number][] | null;
  let locked = false;
  if (node.kind === 'layer') {
    pts = layerCorners(project, node);
    locked = node.locked;
  } else {
    const all = [...walkLayers(node)].flatMap((l) => layerCorners(project, l) ?? []);
    if (!all.length) return null;
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  if (!pts) return null;
  const screen = pts.map(([x, y]) => [x * view.zoom + view.offsetX, y * view.zoom + view.offsetY] as const);
  const layer = node.kind === 'layer' ? node : null;
  const center: [number, number] = layer
    ? [project.canvas.width / 2 + layer.transform.x, project.canvas.height / 2 + layer.transform.y]
    : [0, 0];

  const svgOf = (e: PointerEvent<SVGElement>): SVGSVGElement | null =>
    e.currentTarget instanceof SVGSVGElement ? e.currentTarget : e.currentTarget.ownerSVGElement;
  const toCanvas = (e: PointerEvent<SVGElement>): [number, number] => {
    const r = svgOf(e)?.getBoundingClientRect();
    const sx = e.clientX - (r?.left ?? 0);
    const sy = e.clientY - (r?.top ?? 0);
    return [(sx - view.offsetX) / view.zoom, (sy - view.offsetY) / view.zoom];
  };

  const begin = (mode: Drag['mode']) => (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0 || locked) return;
    e.stopPropagation();
    svgOf(e)?.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    if (mode === 'move' || !layer) setDrag({ mode: 'move', last: p });
    else if (mode === 'scale')
      setDrag({
        mode,
        start: layer.transform,
        center,
        startDist: Math.max(1e-3, Math.hypot(p[0] - center[0], p[1] - center[1])),
      });
    else
      setDrag({
        mode,
        start: layer.transform,
        center,
        startAngle: Math.atan2(p[1] - center[1], p[0] - center[0]),
      });
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toCanvas(e);
    if (drag.mode === 'move') {
      translateNodeCommand(node.id, p[0] - drag.last[0], p[1] - drag.last[1], true);
      setDrag({ mode: 'move', last: p });
    } else if (layer && drag.mode === 'scale') {
      const dist = Math.hypot(p[0] - drag.center[0], p[1] - drag.center[1]);
      const scale = Math.max(0.01, Math.min(8, (drag.start.scale * dist) / drag.startDist));
      setTransformCommand(layer.id, { scale }, true);
    } else if (layer && drag.mode === 'rotate') {
      const angle = Math.atan2(p[1] - drag.center[1], p[0] - drag.center[0]);
      let rotation = drag.start.rotation + ((angle - drag.startAngle) * 180) / Math.PI;
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
      setTransformCommand(layer.id, { rotation: Math.round(rotation * 10) / 10 }, true);
    }
  };

  const end = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
    endGesture();
  };

  const poly = screen.map((p) => p.join(',')).join(' ');
  const [tl, tr] = screen;
  // Drehgriff: 28 px über der Mitte der Oberkante, senkrecht zur Kante
  let rotateHandle: [number, number] | null = null;
  if (layer && tl && tr) {
    const mx = (tl[0] + tr[0]) / 2;
    const my = (tl[1] + tr[1]) / 2;
    const ex = tr[0] - tl[0];
    const ey = tr[1] - tl[1];
    const len = Math.hypot(ex, ey) || 1;
    const sign = layer.transform.flipY ? -1 : 1;
    rotateHandle = [mx + (ey / len) * 28 * sign, my - (ex / len) * 28 * sign];
  }

  return (
    <svg
      className={`transform-overlay${drag ? ' dragging' : ''}${locked ? ' locked' : ''}`}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      data-testid="transform-overlay"
    >
      <polygon
        className="transform-body"
        points={poly}
        onPointerDown={begin('move')}
        data-testid="transform-body"
      />
      {layer && rotateHandle && tl && tr && (
        <>
          <line
            className="transform-stem"
            x1={(tl[0] + tr[0]) / 2}
            y1={(tl[1] + tr[1]) / 2}
            x2={rotateHandle[0]}
            y2={rotateHandle[1]}
          />
          <circle
            className="transform-rotate"
            cx={rotateHandle[0]}
            cy={rotateHandle[1]}
            r={6}
            onPointerDown={begin('rotate')}
            data-testid="transform-rotate"
          >
            <title>Drehen (⇧: in 15°-Schritten)</title>
          </circle>
        </>
      )}
      {layer &&
        screen.map(([x, y], i) => (
          <rect
            key={i}
            className="transform-handle"
            x={x - 5}
            y={y - 5}
            width={10}
            height={10}
            onPointerDown={begin('scale')}
            data-testid={`transform-handle-${i}`}
          />
        ))}
    </svg>
  );
}
