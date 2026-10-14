import { useState, type DragEvent } from 'react';
import { moveEffectCommand, targetNodeId } from '../../state/commands';
import { findNode } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { EFFECT_DRAG_TYPE, EffectCard } from './EffectCard';
import { PlusIcon } from './Icons';

export function Inspector() {
  const project = useProject();
  useAppStore((s) => s.selectedNodeId);
  const setBrowserOpen = useAppStore((s) => s.setEffectBrowserOpen);
  const [drop, setDrop] = useState<{ index: number; side: 'before' | 'after' } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const nodeId = targetNodeId();
  const node = project && nodeId ? findNode(project.root, nodeId) : undefined;
  if (!project || !node || !nodeId) {
    return <p className="panel-empty">Kein Bild geladen.</p>;
  }

  const sideOf = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };

  return (
    <div className="inspector-body">
      <div className="inspector-node">
        <span className="inspector-node-kind">{node.kind === 'group' ? 'Gruppe' : 'Ebene'}</span>
        <span className="inspector-node-name">{node.name}</span>
      </div>
      <div
        className="effect-stack"
        onDragLeave={() => {
          setDrop(null);
        }}
      >
        {node.effects.length === 0 && <p className="panel-empty">Noch keine Effekte.</p>}
        {node.effects.map((fx, i) => (
          <EffectCard
            key={fx.instanceId}
            nodeId={nodeId}
            effect={fx}
            dropIndicator={drop?.index === i && dragId !== fx.instanceId ? drop.side : null}
            onDragStart={(e) => {
              e.dataTransfer.setData(EFFECT_DRAG_TYPE, fx.instanceId);
              e.dataTransfer.effectAllowed = 'move';
              setDragId(fx.instanceId);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) return;
              e.preventDefault();
              setDrop({ index: i, side: sideOf(e) });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData(EFFECT_DRAG_TYPE);
              const from = node.effects.findIndex((x) => x.instanceId === id);
              setDrop(null);
              setDragId(null);
              if (from < 0) return;
              let to = sideOf(e) === 'before' ? i : i + 1;
              if (from < to) to--; // Index bezieht sich auf die Liste ohne das verschobene Element
              if (to !== from) moveEffectCommand(nodeId, id, to);
            }}
          />
        ))}
      </div>
      <button
        className="button add-effect"
        onClick={() => {
          setBrowserOpen(true);
        }}
        data-testid="add-effect"
      >
        <PlusIcon />
        Effekt
      </button>
    </div>
  );
}
