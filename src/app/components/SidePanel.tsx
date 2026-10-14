import { useAppStore } from '../../state/store';
import { ImageIcon } from './Icons';

export function SidePanel() {
  const image = useAppStore((s) => s.image);
  return (
    <aside className="sidepanel">
      <section className="panel-section layers">
        <h2 className="panel-title">Ebenen</h2>
        {image ? (
          <ul className="layer-list">
            <li className="layer-row selected">
              <span className="layer-thumb">
                <ImageIcon />
              </span>
              <span className="layer-name" title={image.fileName}>
                {image.fileName}
              </span>
              <span className="layer-meta">
                {image.width} × {image.height}
              </span>
            </li>
          </ul>
        ) : (
          <p className="panel-empty">Noch keine Ebenen.</p>
        )}
      </section>
      <section className="panel-section inspector">
        <h2 className="panel-title">Inspektor</h2>
        <p className="panel-empty">Effekte folgen in Phase 1.</p>
      </section>
    </aside>
  );
}
