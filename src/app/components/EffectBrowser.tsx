import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePluginStore, type Plugin } from '../../effects/pluginStore';
import { getEngine } from '../../render/runtime';
import { addEffectCommand } from '../../state/commands';
import type { Project } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';

function Thumbnail({ plugin, project }: { plugin: Plugin; project: Project | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const engine = getEngine();
    if (!engine || !project || plugin.status !== 'ok') return;
    void engine.effectThumbnail(project, plugin).then((img) => {
      const canvas = canvasRef.current;
      if (cancelled || !img || !canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')?.putImageData(img, 0, 0);
      setLive(true);
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, project]);

  return (
    <span className="effect-thumb">
      <canvas ref={canvasRef} style={{ display: live ? 'block' : 'none' }} />
      {!live && plugin.previewUrl && <img src={plugin.previewUrl} alt="" />}
      {!live && !plugin.previewUrl && (
        <span className="effect-thumb-placeholder">
          {(plugin.manifest?.name ?? plugin.folder).slice(0, 2)}
        </span>
      )}
    </span>
  );
}

export function EffectBrowser() {
  const open = useAppStore((s) => s.effectBrowserOpen);
  const setOpen = useAppStore((s) => s.setEffectBrowserOpen);
  const plugins = usePluginStore((s) => s.plugins);
  const project = useProject();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Plugin[]>();
    for (const p of Object.values(plugins)) {
      const name = p.manifest?.name ?? p.folder;
      if (q && !`${name} ${p.folder} ${p.manifest?.category ?? ''}`.toLowerCase().includes(q)) continue;
      const cat = p.manifest?.category ?? 'Fehlerhaft';
      map.set(cat, [...(map.get(cat) ?? []), p]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'de'));
  }, [plugins, query]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog effect-browser"
          data-testid="effect-browser"
          aria-describedby={undefined}
        >
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">Effekt hinzufügen</Dialog.Title>
            <input
              className="search-input"
              placeholder="Suchen …"
              value={query}
              autoFocus
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </div>
          <div className="effect-browser-body">
            {groups.length === 0 && <p className="panel-empty">Keine Effekte gefunden.</p>}
            {groups.map(([category, list]) => (
              <section key={category}>
                <h3 className="panel-title">{category}</h3>
                <div className="effect-grid">
                  {list.map((p) => {
                    const ok = p.status === 'ok';
                    return (
                      <button
                        key={p.folder}
                        className={`effect-tile${ok ? '' : ' broken'}`}
                        data-testid={`effect-tile-${p.folder}`}
                        disabled={!ok || !project}
                        title={ok ? p.manifest?.description : p.errors.join('\n')}
                        onClick={() => {
                          addEffectCommand(p.folder);
                          setOpen(false);
                        }}
                      >
                        <Thumbnail plugin={p} project={project} />
                        <span className="effect-tile-name">{p.manifest?.name ?? p.folder}</span>
                        {p.status === 'pending' && <span className="effect-tile-note">wird geladen …</span>}
                        {p.status === 'error' && (
                          <span className="effect-tile-error" data-testid={`effect-error-${p.folder}`}>
                            {p.errors.slice(0, 3).join(' · ')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
