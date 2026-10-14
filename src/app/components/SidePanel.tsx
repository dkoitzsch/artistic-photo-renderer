import { Inspector } from './Inspector';
import { LayerList } from './LayerList';

export function SidePanel() {
  return (
    <aside className="sidepanel">
      <section className="panel-section layers">
        <h2 className="panel-title">Ebenen</h2>
        <LayerList />
      </section>
      <section className="panel-section inspector">
        <h2 className="panel-title">Inspektor</h2>
        <Inspector />
      </section>
    </aside>
  );
}
