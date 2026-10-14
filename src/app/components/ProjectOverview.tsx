import { useEffect, useState } from 'react';
import { openFileDialog } from '../../io/openDialog';
import { openStoredProject } from '../../io/import';
import { deleteProject, listProjects, loadThumbnail, type ProjectSummary } from '../../io/storage';
import { useAppStore } from '../../state/store';
import { OpenIcon, TrashIcon } from './Icons';

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let cancelled = false;
    void loadThumbnail(id).then((f) => {
      if (!f || cancelled) return;
      u = URL.createObjectURL(f);
      setUrl(u);
    });
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return <span className="project-thumb">{url && <img src={url} alt="" />}</span>;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** Projektübersicht beim Start: lokal gespeicherte Projekte mit Miniaturen. */
export function ProjectOverview() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const gpuReady = useAppStore((s) => s.gpu.state === 'ready');
  const setScreen = useAppStore((s) => s.setScreen);

  const reload = () => {
    void listProjects()
      .then(setProjects)
      .catch(() => {
        setProjects([]);
      });
  };
  useEffect(reload, []);

  return (
    <div className="overview" data-testid="project-overview">
      <div className="overview-head">
        <h1>Projekte</h1>
        <div className="overview-actions">
          <button
            className="button"
            onClick={() => {
              setScreen('editor');
            }}
          >
            Zur Arbeitsfläche
          </button>
          <button className="button primary" onClick={openFileDialog} disabled={!gpuReady}>
            <OpenIcon />
            Bild oder Projektdatei öffnen
          </button>
        </div>
      </div>
      {projects === null ? (
        <p className="panel-empty">Lade …</p>
      ) : projects.length === 0 ? (
        <p className="panel-empty">Noch keine Projekte. Öffne ein Bild, um zu beginnen.</p>
      ) : (
        <ul className="project-grid">
          {projects.map((p) => (
            <li key={p.id} className="project-card" data-testid="project-card">
              <button
                className="project-open"
                disabled={!gpuReady}
                onClick={() => void openStoredProject(p.id)}
                title={`${p.name} öffnen`}
              >
                <Thumb id={p.id} />
                <span className="project-name-label">{p.name}</span>
                <span className="project-meta">
                  {p.width} × {p.height} · {dateFormat.format(new Date(p.updatedAt))}
                </span>
              </button>
              <button
                className="icon-button small project-delete"
                title="Projekt löschen"
                aria-label={`${p.name} löschen`}
                onClick={() => {
                  if (window.confirm(`„${p.name}“ endgültig löschen?`)) void deleteProject(p.id).then(reload);
                }}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
