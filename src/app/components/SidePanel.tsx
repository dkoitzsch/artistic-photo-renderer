import { setNodeVisibleCommand } from '../../state/commands';
import type { SceneNode } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { EyeIcon, EyeOffIcon, ImageIcon, LayersIcon, ShadowIcon } from './Icons';
import { Inspector } from './Inspector';

function isNc(node: SceneNode): boolean {
  if (node.kind !== 'layer') return false;
  return (
    (node.mask.kind === 'stored' && !node.mask.provenance.commercialUse) ||
    (node.focusMap?.provenance !== undefined && !node.focusMap.provenance.commercialUse)
  );
}

function Row({
  id,
  name,
  kind,
  depth,
  visible,
  meta,
  nc,
}: {
  id: string;
  name: string;
  kind: 'group' | 'layer' | 'shadow';
  depth: number;
  visible: boolean;
  meta: string;
  nc: boolean;
}) {
  const selected = useAppStore((s) => s.selectedNodeId === id);
  const select = useAppStore((s) => s.select);
  return (
    <li className={`layer-item${visible ? '' : ' hidden'}`}>
      <button
        className={`layer-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: `calc(var(--space-2) + ${depth * 16}px)` }}
        onClick={() => {
          select(id);
        }}
        data-testid={`layer-row-${kind}`}
        data-name={name}
      >
        <span className="layer-thumb">
          {kind === 'group' ? <LayersIcon /> : kind === 'shadow' ? <ShadowIcon /> : <ImageIcon />}
        </span>
        <span className="layer-name" title={name}>
          {name}
        </span>
        <span className="layer-meta">
          {nc && (
            <span
              className="license-badge nc"
              title="Enthält Ergebnisse eines nur nicht-kommerziell nutzbaren Modells"
            >
              NC
            </span>
          )}
          {meta}
        </span>
      </button>
      <button
        className="icon-button small layer-eye"
        aria-label={visible ? `${name} ausblenden` : `${name} einblenden`}
        onClick={() => {
          setNodeVisibleCommand(id, !visible);
        }}
      >
        {visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
    </li>
  );
}

function NodeRows({ node, depth }: { node: SceneNode; depth: number }) {
  const fx = node.effects.filter((e) => e.enabled).length;
  const sh = node.kind === 'layer' ? node.shadow : undefined;
  return (
    <>
      <Row
        id={node.id}
        name={node.name}
        kind={node.kind}
        depth={depth}
        visible={node.visible}
        meta={fx > 0 ? `${fx} fx` : ''}
        nc={isNc(node)}
      />
      {node.kind === 'group' &&
        [...node.children].reverse().map((c) => <NodeRows key={c.id} node={c} depth={depth + 1} />)}
      {sh && (
        <Row
          id={sh.id}
          name="Schatten"
          kind="shadow"
          depth={depth + 1}
          visible={sh.visible}
          meta={sh.effects.length ? `${sh.effects.length} fx` : ''}
          nc={false}
        />
      )}
    </>
  );
}

export function SidePanel() {
  const project = useProject();
  return (
    <aside className="sidepanel">
      <section className="panel-section layers">
        <h2 className="panel-title">Ebenen</h2>
        {project ? (
          <ul className="layer-list">
            <NodeRows node={project.root} depth={0} />
          </ul>
        ) : (
          <p className="panel-empty">Noch keine Ebenen.</p>
        )}
      </section>
      <section className="panel-section inspector">
        <h2 className="panel-title">Inspektor</h2>
        <Inspector />
      </section>
    </aside>
  );
}
