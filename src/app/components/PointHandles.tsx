// Griffe für Punkt-Parameter (E3): Effekte der ausgewählten Ebene/Gruppe mit Parametern vom Typ "point" (Lichtquelle von
// „Neu beleuchten“, „Lichtstrahlen“ …) zeigen im Werkzeug „Verschieben“ einen ziehbaren Griff auf der Leinwand. Hat der
// Effekt eine Auswahl mit der Option „custom“ (Eigener Punkt), wird sie beim Ziehen gesetzt.

import { useState, type PointerEvent } from 'react';
import { getPlugin } from '../../effects/pluginStore';
import { endGesture, setParamCommand } from '../../state/commands';
import { findNode } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';

type Handle = { nodeId: string; instanceId: string; key: string; label: string; x: number; y: number };

export function PointHandles() {
  const project = useProject();
  const selected = useAppStore((s) => s.selectedNodeId);
  const view = useAppStore((s) => s.view);
  const tool = useAppStore((s) => s.tool);
  const viewMode = useAppStore((s) => s.viewMode);
  const comparing = useAppStore((s) => s.compareSplit !== null);
  const [drag, setDrag] = useState<Handle | null>(null);
  if (!project || !selected || tool !== 'move' || viewMode !== 'result' || comparing) return null;
  const node = findNode(project.root, selected);
  if (!node) return null;
  const handles: Handle[] = [];
  for (const fx of node.effects) {
    if (!fx.enabled) continue;
    const m = getPlugin(fx.effectId)?.manifest;
    if (!m) continue;
    for (const spec of m.params) {
      if (spec.type !== 'point') continue;
      const v = fx.params[spec.key];
      const [x, y] = Array.isArray(v) && typeof v[0] === 'number' ? (v as [number, number]) : spec.default;
      handles.push({
        nodeId: node.id,
        instanceId: fx.instanceId,
        key: spec.key,
        label: `${m.name}: ${spec.label}`,
        x,
        y,
      });
    }
  }
  if (!handles.length) return null;

  const toCanvas = (e: PointerEvent<HTMLElement>): [number, number] => {
    const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
    const cx = (e.clientX - r.left - view.offsetX) / view.zoom;
    const cy = (e.clientY - r.top - view.offsetY) / view.zoom;
    return [
      Math.round(Math.min(project.canvas.width, Math.max(0, cx))),
      Math.round(Math.min(project.canvas.height, Math.max(0, cy))),
    ];
  };
  const move = (h: Handle, e: PointerEvent<HTMLElement>) => {
    const p = toCanvas(e);
    setParamCommand(h.nodeId, h.instanceId, h.key, p, true);
  };
  return (
    <div className="point-handles">
      {handles.map((h) => (
        <span
          key={`${h.instanceId}:${h.key}`}
          className={`point-handle${drag?.instanceId === h.instanceId && drag.key === h.key ? ' dragging' : ''}`}
          data-testid={`point-handle-${h.key}`}
          title={`${h.label} – ziehen`}
          style={{ left: h.x * view.zoom + view.offsetX, top: h.y * view.zoom + view.offsetY }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(h);
            const m = getPlugin(
              findNode(project.root, h.nodeId)?.effects.find((f) => f.instanceId === h.instanceId)
                ?.effectId ?? '',
            )?.manifest;
            const chooser = m?.params.find(
              (s) => s.type === 'enum' && s.options.some((o) => o.value === 'custom'),
            );
            if (chooser) setParamCommand(h.nodeId, h.instanceId, chooser.key, 'custom', true);
          }}
          onPointerMove={(e) => {
            if (drag) move(drag, e);
          }}
          onPointerUp={(e) => {
            if (drag) move(drag, e);
            setDrag(null);
            endGesture();
          }}
        >
          ☀
        </span>
      ))}
    </div>
  );
}
