import type { SceneNode } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { ImageIcon, LayersIcon } from './Icons';
import { Inspector } from './Inspector';

function NodeRow({ node, depth }: { node: SceneNode; depth: number }) {
  const selected = useAppStore((s) => s.selectedNodeId === node.id);
  const select = useAppStore((s) => s.select);
  const fxCount = node.effects.filter((e) => e.enabled).length;
  return (
    <>
      <li>
        <button
          className={`layer-row${selected ? ' selected' : ''}`}
          style={{ paddingLeft: `calc(var(--space-2) + ${depth * 16}px)` }}
          onClick={() => {
            select(node.id);
          }}
          data-testid={`layer-row-${node.kind}`}
        >
          <span className="layer-thumb">{node.kind === 'group' ? <LayersIcon /> : <ImageIcon />}</span>
          <span className="layer-name" title={node.name}>
            {node.name}
          </span>
          <span className="layer-meta">{fxCount > 0 ? `${fxCount} fx` : ''}</span>
        </button>
      </li>
      {node.kind === 'group' &&
        [...node.children].reverse().map((c) => <NodeRow key={c.id} node={c} depth={depth + 1} />)}
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
            <NodeRow node={project.root} depth={0} />
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
