// Ebenenliste (Spec h): Gruppen aufklappbar mit Miniatur, Ziehen zum Umsortieren/Verschachteln,
// Gruppieren und Auflösen, Sichtbarkeit, NC-Badge, Schatten als eigene Zeile.

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { getEngine } from '../../render/runtime';
import {
  groupNodeCommand,
  moveNodeCommand,
  setNodeVisibleCommand,
  ungroupCommand,
} from '../../state/commands';
import { findNode, parentOf, walk, type Project, type SceneNode } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LayersIcon,
  ShadowIcon,
} from './Icons';

const DRAG_TYPE = 'application/x-bls-node';

type Drop = { id: string; zone: 'above' | 'below' | 'into' };

function isNc(node: SceneNode): boolean {
  if (node.kind !== 'layer') return false;
  return (
    (node.mask.kind === 'stored' && !node.mask.provenance.commercialUse) ||
    (node.focusMap?.provenance !== undefined && !node.focusMap.provenance.commercialUse) ||
    (node.depthMap !== undefined && !node.depthMap.provenance.commercialUse)
  );
}

/** Miniaturen aller Knoten, entprellt nach Änderungen. */
function useThumbnails(project: Project | null): Map<string, ImageData> {
  const [thumbs, setThumbs] = useState<Map<string, ImageData>>(new Map());
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const engine = getEngine();
      if (!engine) return;
      const ids = [...walk(project.root)].filter((n) => n.id !== project.root.id).map((n) => n.id);
      engine
        .nodeThumbnails(project, ids)
        .then((m) => {
          if (!cancelled) setThumbs(m);
        })
        .catch(() => undefined);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project]);
  return thumbs;
}

function Thumb({ image, kind }: { image: ImageData | undefined; kind: 'group' | 'layer' | 'shadow' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !image) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')?.putImageData(image, 0, 0);
  }, [image]);
  return (
    <span className="layer-thumb">
      {image ? (
        <canvas ref={ref} />
      ) : kind === 'group' ? (
        <LayersIcon />
      ) : kind === 'shadow' ? (
        <ShadowIcon />
      ) : (
        <ImageIcon />
      )}
    </span>
  );
}

export function LayerList() {
  const project = useProject();
  const selected = useAppStore((s) => s.selectedNodeId);
  const select = useAppStore((s) => s.select);
  const thumbs = useThumbnails(project);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  if (!project) return <p className="panel-empty">Noch keine Ebenen.</p>;

  const zoneOf = (e: DragEvent, node: SceneNode): Drop['zone'] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    if (node.kind === 'group' && t > 0.3 && t < 0.7) return 'into';
    return t < 0.5 ? 'above' : 'below';
  };

  const onDrop = (target: SceneNode, zone: Drop['zone'], id: string) => {
    if (id === target.id) return;
    if (zone === 'into' && target.kind === 'group') {
      moveNodeCommand(id, target.id, target.children.length);
      return;
    }
    const parent = parentOf(project.root, target.id);
    if (!parent) return;
    const i = parent.children.findIndex((c) => c.id === target.id);
    const from = parent.children.findIndex((c) => c.id === id);
    // Liste zeigt vorn oben: „über“ = davor = höherer Index
    let index = zone === 'above' ? i + 1 : i;
    if (from >= 0 && from < index) index--;
    moveNodeCommand(id, parent.id, index);
  };

  const row = (node: SceneNode, depth: number) => {
    const isRoot = node.id === project.root.id;
    const fx = node.effects.filter((e) => e.enabled).length;
    const open = !collapsed.has(node.id);
    const zone = drop?.id === node.id ? drop.zone : null;
    return (
      <li
        key={node.id}
        className={`layer-item${node.visible ? '' : ' hidden'}${zone ? ` drop-${zone}` : ''}`}
      >
        <div
          className={`layer-row${selected === node.id ? ' selected' : ''}${dragId === node.id ? ' dragging' : ''}`}
          style={{ paddingLeft: `calc(var(--space-1) + ${depth * 14}px)` }}
          draggable={!isRoot}
          onClick={() => {
            select(node.id);
          }}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, node.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragId(node.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDrop(null);
          }}
          onDragOver={(e) => {
            if (isRoot || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            setDrop({ id: node.id, zone: zoneOf(e, node) });
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData(DRAG_TYPE);
            setDrop(null);
            setDragId(null);
            if (id && !isRoot) onDrop(node, zoneOf(e, node), id);
          }}
          role="button"
          tabIndex={0}
          data-testid={`layer-row-${node.kind}`}
          data-name={node.name}
          data-id={node.id}
        >
          {node.kind === 'group' ? (
            <button
              className="layer-toggle"
              aria-label={open ? 'Zuklappen' : 'Aufklappen'}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(node.id)) n.delete(node.id);
                  else n.add(node.id);
                  return n;
                });
              }}
            >
              {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </button>
          ) : (
            <span className="layer-toggle-spacer" />
          )}
          <Thumb image={isRoot ? undefined : thumbs.get(node.id)} kind={node.kind} />
          <span className="layer-name" title={node.name}>
            {node.name}
          </span>
          <span className="layer-meta">
            {isNc(node) && (
              <span
                className="license-badge nc"
                title="Enthält Ergebnisse eines nur nicht-kommerziell nutzbaren Modells"
              >
                NC
              </span>
            )}
            {node.kind === 'group' && node.editMode === 'group' && (
              <span className="group-mode-badge">G</span>
            )}
            {fx > 0 ? `${fx} fx` : ''}
          </span>
          {!isRoot && (
            <button
              className="icon-button small layer-eye"
              aria-label={node.visible ? `${node.name} ausblenden` : `${node.name} einblenden`}
              onClick={(e) => {
                e.stopPropagation();
                setNodeVisibleCommand(node.id, !node.visible);
              }}
            >
              {node.visible ? <EyeIcon /> : <EyeOffIcon />}
            </button>
          )}
        </div>
        {node.kind === 'group' && open && (
          <ul className="layer-children">{[...node.children].reverse().map((c) => row(c, depth + 1))}</ul>
        )}
        {node.kind === 'layer' && node.shadow && (
          <ul className="layer-children">
            <li className={`layer-item${node.shadow.visible ? '' : ' hidden'}`}>
              <div
                className={`layer-row${selected === node.shadow.id ? ' selected' : ''}`}
                style={{ paddingLeft: `calc(var(--space-1) + ${(depth + 1) * 14}px)` }}
                onClick={() => {
                  if (node.shadow) select(node.shadow.id);
                }}
                role="button"
                tabIndex={0}
                data-testid="layer-row-shadow"
              >
                <span className="layer-toggle-spacer" />
                <Thumb image={undefined} kind="shadow" />
                <span className="layer-name">Schatten</span>
                <span className="layer-meta">
                  {node.shadow.effects.length ? `${node.shadow.effects.length} fx` : ''}
                </span>
                <button
                  className="icon-button small layer-eye"
                  aria-label={node.shadow.visible ? 'Schatten ausblenden' : 'Schatten einblenden'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (node.shadow) setNodeVisibleCommand(node.shadow.id, !node.shadow.visible);
                  }}
                >
                  {node.shadow.visible ? <EyeIcon /> : <EyeOffIcon />}
                </button>
              </div>
            </li>
          </ul>
        )}
      </li>
    );
  };

  const sel = selected ? findNode(project.root, selected) : undefined;
  return (
    <>
      <ul className="layer-list" data-testid="layer-list">
        {row(project.root, 0)}
      </ul>
      <div className="layer-actions">
        <button
          className="button small"
          disabled={!sel || sel.id === project.root.id}
          onClick={() => {
            if (sel) groupNodeCommand(sel.id);
          }}
          title="Ausgewählte Ebene in eine neue Gruppe packen"
          data-testid="group-button"
        >
          Gruppieren
        </button>
        <button
          className="button small"
          disabled={sel?.kind !== 'group' || sel.id === project.root.id}
          onClick={() => {
            if (sel) ungroupCommand(sel.id);
          }}
          title="Gruppe auflösen (Kinder bleiben erhalten)"
          data-testid="ungroup-button"
        >
          Auflösen
        </button>
      </div>
    </>
  );
}
