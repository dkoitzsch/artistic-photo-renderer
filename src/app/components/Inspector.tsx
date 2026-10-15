import { useState, type DragEvent } from 'react';
import { moveEffectCommand, targetNodeId } from '../../state/commands';
import { findHost, parentOf, type EffectInstance } from '../../state/project';
import { GroupEditSection } from './GroupSections';
import { useAppStore, useProject } from '../../state/store';
import { EFFECT_DRAG_TYPE, EffectCard } from './EffectCard';
import { PlusIcon } from './Icons';
import { FocusSection, MaskSection, NodeSection, ShadowParams, ShadowSection } from './LayerSections';
import { TransformSection } from './TransformSection';

function EffectStack({
  hostId,
  effects,
  groupMode = false,
}: {
  hostId: string;
  effects: EffectInstance[];
  groupMode?: boolean;
}) {
  const setBrowserOpen = useAppStore((s) => s.setEffectBrowserOpen);
  const [drop, setDrop] = useState<{ index: number; side: 'before' | 'after' } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const sideOf = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  return (
    <>
      <div
        className="effect-stack"
        onDragLeave={() => {
          setDrop(null);
        }}
      >
        {effects.length === 0 && <p className="panel-empty">Noch keine Effekte.</p>}
        {effects.map((fx, i) => (
          <EffectCard
            key={fx.instanceId}
            nodeId={hostId}
            effect={fx}
            groupMode={groupMode}
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
              const from = effects.findIndex((x) => x.instanceId === id);
              setDrop(null);
              setDragId(null);
              if (from < 0) return;
              let to = sideOf(e) === 'before' ? i : i + 1;
              if (from < to) to--; // Index bezieht sich auf die Liste ohne das verschobene Element
              if (to !== from) moveEffectCommand(hostId, id, to);
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
    </>
  );
}

export function Inspector() {
  const project = useProject();
  useAppStore((s) => s.selectedNodeId);
  const hostId = targetNodeId();
  const found = project && hostId ? findHost(project.root, hostId) : undefined;
  if (!project || !found || !hostId) {
    return <p className="panel-empty">Kein Bild geladen.</p>;
  }
  const { host, layer } = found;

  // Schatten-Layer
  if (layer?.shadow && host === layer.shadow) {
    return (
      <div className="inspector-body">
        <div className="inspector-node">
          <span className="inspector-node-kind">Schatten von</span>
          <span className="inspector-node-name">{layer.name}</span>
        </div>
        <ShadowParams layer={layer} />
        <h3 className="section-title">Effekte des Schattens</h3>
        <EffectStack hostId={hostId} effects={host.effects} />
      </div>
    );
  }
  if (!('kind' in host)) return null;
  const inGroupMode = parentOf(project.root, host.id)?.editMode === 'group';

  return (
    <div className="inspector-body">
      <div className="inspector-node">
        <span className="inspector-node-kind">{host.kind === 'group' ? 'Gruppe' : 'Ebene'}</span>
        <span className="inspector-node-name">{host.name}</span>
      </div>
      <NodeSection node={host} isRoot={host.id === project.root.id} />
      {host.kind === 'layer' && (
        <>
          <TransformSection key={`transform-${host.id}`} layer={host} project={project} />
          <MaskSection key={`mask-${host.id}`} layer={host} />
          <FocusSection key={`focus-${host.id}`} layer={host} />
          <ShadowSection key={`shadow-${host.id}`} layer={host} />
        </>
      )}
      {host.kind === 'group' && host.id !== project.root.id && (
        <GroupEditSection key={`group-${host.id}`} group={host} />
      )}
      <h3 className="section-title">
        {host.kind === 'group' ? 'Effekte auf das Gruppenergebnis' : 'Effekte'}
      </h3>
      <EffectStack hostId={hostId} effects={host.effects} groupMode={inGroupMode} />
    </div>
  );
}
