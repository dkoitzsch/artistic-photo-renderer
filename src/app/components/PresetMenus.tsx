// Preset-Menüs (Spec „Effekte“ 2.6): Effekt-Presets in der Effektkarte (mitgeliefert + eigene, mit Vorschaubild)
// und Stapel-Presets im Inspektor (ganze Effekt-Kombination ersetzen/anhängen, Export/Import).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadBlob } from '../../io/export';
import type { EffectManifest, ParamValue } from '../../effects/manifest';
import { presetEffectsFrom } from '../../presets/model';
import {
  addEffectPreset,
  addStackPreset,
  deleteEffectPreset,
  deleteStackPreset,
  exportPresetsJson,
  importPresetsJson,
  usePresetStore,
} from '../../presets/store';
import { effectPresetThumbnail, imageDataUrl, nodeThumbnail } from '../../presets/thumbnails';
import { applyPresetCommand, applyStackPresetCommand } from '../../state/commands';
import { firstLayer, type EffectInstance, type Project } from '../../state/project';
import { useAppStore, useProject } from '../../state/store';
import { ChevronDownIcon, TrashIcon } from './Icons';

/** Aufklappbares Menü; schließt bei Klick außerhalb und mit Escape. */
function Popover({
  label,
  testId,
  children,
}: {
  label: ReactNode;
  testId: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className="button small"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {label}
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="popover" role="menu" data-testid={`${testId}-menu`}>
          {children(() => {
            setOpen(false);
          })}
        </div>
      )}
    </div>
  );
}

// Live-Miniaturen mitgelieferter Presets: je Original, Effekt und Preset einmal berechnet
const liveThumbs = new Map<string, string>();

function LiveThumb({
  project,
  effectId,
  name,
  values,
}: {
  project: Project;
  effectId: string;
  name: string;
  values: Record<string, ParamValue>;
}) {
  const key = `${firstLayer(project)?.originalId ?? ''}|${effectId}|${name}`;
  const [url, setUrl] = useState(liveThumbs.get(key) ?? null);
  useEffect(() => {
    if (url) return;
    let cancelled = false;
    void effectPresetThumbnail(project, effectId, values)
      .then((img) => (img ? imageDataUrl(img) : null))
      .then((u) => {
        if (!u || cancelled) return;
        liveThumbs.set(key, u);
        setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, url, project, effectId, values]);
  return <Thumb url={url} />;
}

function Thumb({ url }: { url: string | null | undefined }) {
  return <span className="preset-thumb">{url ? <img src={url} alt="" /> : null}</span>;
}

/** Name eingeben und sichern. */
function SaveRow({
  placeholder,
  onSave,
  testId,
}: {
  placeholder: string;
  onSave: (name: string) => void;
  testId: string;
}) {
  const [name, setName] = useState('');
  const save = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName('');
  };
  return (
    <div className="preset-save">
      <input
        className="text-input"
        placeholder={placeholder}
        value={name}
        data-testid={`${testId}-name`}
        onChange={(e) => {
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
      />
      <button
        className="button small primary"
        disabled={!name.trim()}
        onClick={save}
        data-testid={`${testId}-save`}
      >
        Sichern
      </button>
    </div>
  );
}

export function EffectPresetMenu({
  nodeId,
  effect,
  manifest,
}: {
  nodeId: string;
  effect: EffectInstance;
  manifest: EffectManifest;
}) {
  const project = useProject();
  // Selektor liefert die gespeicherte Liste (stabile Referenz); gefiltert wird danach
  const all = usePresetStore((s) => s.effects);
  const own = all.filter((p) => p.effectId === effect.effectId);
  if (!project) return null;
  return (
    <Popover label="Presets" testId="preset-menu">
      {(close) => (
        <>
          {manifest.presets && manifest.presets.length > 0 && (
            <div className="preset-heading">Mitgeliefert</div>
          )}
          {manifest.presets?.map((p) => (
            <button
              key={p.name}
              className="preset-item"
              role="menuitem"
              onClick={() => {
                applyPresetCommand(nodeId, effect.instanceId, p.name, p.values);
                close();
              }}
            >
              <LiveThumb project={project} effectId={effect.effectId} name={p.name} values={p.values} />
              <span className="preset-name">{p.name}</span>
            </button>
          ))}
          <div className="preset-heading">Eigene</div>
          {own.length === 0 && <p className="preset-empty">Noch keine eigenen Presets.</p>}
          {own.map((p) => (
            <div key={p.id} className="preset-item-row">
              <button
                className="preset-item"
                role="menuitem"
                data-testid="own-preset"
                onClick={() => {
                  applyPresetCommand(nodeId, effect.instanceId, p.name, p.values);
                  close();
                }}
              >
                <Thumb url={p.thumbnail} />
                <span className="preset-name">{p.name}</span>
              </button>
              <button
                className="icon-button small"
                title="Preset löschen"
                aria-label={`Preset ${p.name} löschen`}
                onClick={() => {
                  deleteEffectPreset(p.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <SaveRow
            placeholder="Aktuelle Einstellungen als …"
            testId="effect-preset"
            onSave={(name) => {
              void effectPresetThumbnail(project, effect.effectId, effect.params)
                .then((img) => (img ? imageDataUrl(img) : undefined))
                .catch(() => undefined)
                .then((thumbnail) => {
                  addEffectPreset({
                    effectId: effect.effectId,
                    effectVersion: effect.effectVersion,
                    name,
                    values: { ...effect.params },
                    ...(thumbnail ? { thumbnail } : {}),
                  });
                });
            }}
          />
        </>
      )}
    </Popover>
  );
}

export function StackPresetMenu({ hostId, effects }: { hostId: string; effects: EffectInstance[] }) {
  const project = useProject();
  const stacks = usePresetStore((s) => s.stacks);
  const notify = useAppStore((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!project) return null;
  return (
    <Popover label="Stapel-Presets" testId="stack-preset-menu">
      {(close) => (
        <>
          {stacks.length === 0 && <p className="preset-empty">Noch keine Stapel-Presets.</p>}
          {stacks.map((p) => (
            <div key={p.id} className="preset-item-row" data-testid="stack-preset">
              <Thumb url={p.thumbnail} />
              <span className="preset-name" title={p.effects.map((e) => e.effectId).join(', ')}>
                {p.name}
              </span>
              <button
                className="button small"
                data-testid="stack-preset-replace"
                onClick={() => {
                  applyStackPresetCommand(hostId, p, 'replace');
                  close();
                }}
              >
                Ersetzen
              </button>
              <button
                className="button small"
                data-testid="stack-preset-append"
                onClick={() => {
                  applyStackPresetCommand(hostId, p, 'append');
                  close();
                }}
              >
                Anhängen
              </button>
              <button
                className="icon-button small"
                title="Stapel-Preset löschen"
                aria-label={`Stapel-Preset ${p.name} löschen`}
                onClick={() => {
                  deleteStackPreset(p.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          {effects.length > 0 && (
            <SaveRow
              placeholder="Aktuellen Stapel sichern als …"
              testId="stack-preset"
              onSave={(name) => {
                void nodeThumbnail(project, hostId)
                  .then((img) => (img ? imageDataUrl(img) : undefined))
                  .catch(() => undefined)
                  .then((thumbnail) => {
                    addStackPreset({
                      name,
                      effects: presetEffectsFrom(effects),
                      ...(thumbnail ? { thumbnail } : {}),
                    });
                  });
              }}
            />
          )}
          <div className="preset-actions">
            <button
              className="button small"
              data-testid="presets-export"
              onClick={() => {
                downloadBlob(
                  new Blob([exportPresetsJson()], { type: 'application/json' }),
                  'presets.blurpresets.json',
                );
              }}
            >
              Exportieren …
            </button>
            <button
              className="button small"
              data-testid="presets-import"
              onClick={() => {
                fileRef.current?.click();
              }}
            >
              Importieren …
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="presets-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void f
                  .text()
                  .then((t) => {
                    const n = importPresetsJson(t);
                    notify('info', `Presets importiert: ${n.effects} Effekt-, ${n.stacks} Stapel-Presets.`);
                  })
                  .catch((err: unknown) => {
                    notify(
                      'error',
                      `Import fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  });
              }}
            />
          </div>
        </>
      )}
    </Popover>
  );
}
