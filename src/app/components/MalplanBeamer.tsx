// Beamer-Modus des Malplans: eigenes Fenster (aufs Projektor-Display ziehen, dort F für Vollbild). Das Hauptfenster
// schickt die gewählte Hilfe als PNG und übernimmt die gezogenen Ecken ins Projekt.

import { useEffect, useMemo } from 'react';
import { BEAMER_CHANNEL, type BeamerMessage } from '../../malplan/beamerChannel';
import { HELPS, normalizeMalplan, type HelpId } from '../../malplan/model';
import { drawGrid, renderHelp } from '../../malplan/render';
import { useMalplanStore } from '../../malplan/store';
import { setMalplanCommand } from '../../state/commands';
import { useProject } from '../../state/store';
import { Toggle } from '../controls/Toggle';

/** Hält das Beamer-Fenster aktuell (läuft, solange der Malplan offen ist). */
export function useBeamerSync(): void {
  const project = useProject();
  const result = useMalplanStore((s) => s.result);
  const derived = useMalplanStore((s) => s.derived);
  const settings = useMemo(
    () => (project ? normalizeMalplan(project.malplan, project.canvas) : null),
    [project],
  );
  useEffect(() => {
    if (!settings) return;
    const ch = new BroadcastChannel(BEAMER_CHANNEL);
    const { help, grid, corners } = settings.beamer;
    let alive = true;
    const send = () => {
      const c = renderHelp(help, result, derived, settings, useMalplanStore.getState().palette);
      if (!c) return;
      if (grid && help !== 'grid') {
        const g = c.getContext('2d');
        if (g) drawGrid(g, c.width, c.height, settings);
      }
      c.toBlob((png) => {
        if (!png || !alive) return;
        ch.postMessage({
          type: 'image',
          png,
          aspect: c.width / c.height,
          corners,
          label: HELPS.find((h) => h.id === help)?.label ?? help,
        } satisfies BeamerMessage);
      }, 'image/png');
    };
    ch.onmessage = (e: MessageEvent<BeamerMessage>) => {
      const msg = e.data;
      if (msg.type === 'hello') send();
      else if (msg.type === 'corners')
        setMalplanCommand({ beamer: { ...settings.beamer, corners: msg.corners } }, false, 'Beamer-Ecken');
    };
    send();
    return () => {
      alive = false;
      ch.close();
    };
  }, [settings, result, derived]);
}

export function BeamerButton() {
  const project = useProject();
  if (!project) return null;
  const s = normalizeMalplan(project.malplan, project.canvas);
  const setBeamer = (patch: Partial<typeof s.beamer>) => {
    setMalplanCommand({ beamer: { ...s.beamer, ...patch } });
  };
  return (
    <div className="beamer-controls">
      <div className="control-row">
        <span className="control-label">Beamer zeigt</span>
        <select
          className="select"
          aria-label="Beamer zeigt"
          data-testid="beamer-help"
          value={s.beamer.help}
          onChange={(e) => {
            setBeamer({ help: e.target.value as HelpId });
          }}
        >
          {HELPS.filter((h) => h.id !== 'scale').map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      <Toggle
        label="Raster darüber"
        value={s.beamer.grid}
        onChange={(v) => {
          setBeamer({ grid: v });
        }}
      />
      <button
        className="button small"
        data-testid="beamer-open"
        onClick={() => {
          window.open('/beamer.html', 'bls-malplan-beamer', 'popup,width=1280,height=800');
        }}
      >
        Beamer-Fenster öffnen
      </button>
    </div>
  );
}
