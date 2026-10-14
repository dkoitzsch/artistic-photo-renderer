import { useAppStore } from '../../state/store';

/** Verständliche Meldung, wenn WebGPU fehlt oder verloren geht. */
export function GpuStatus() {
  const gpu = useAppStore((s) => s.gpu);
  if (gpu.state === 'ready') return null;
  if (gpu.state === 'pending') {
    return <div className="gpu-overlay subtle">WebGPU wird initialisiert …</div>;
  }
  if (gpu.state === 'lost') {
    return (
      <div className="gpu-overlay" role="alert">
        <div className="gpu-card">
          <h2>Verbindung zur GPU verloren</h2>
          <p>{gpu.reason}</p>
          <p>
            Das passiert z. B. nach einem Treiber-Neustart oder bei Speichermangel. Laden Sie die Seite neu.
          </p>
          <button
            className="button primary"
            onClick={() => {
              location.reload();
            }}
          >
            Neu laden
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="gpu-overlay" role="alert" data-testid="gpu-unavailable">
      <div className="gpu-card">
        <h2>WebGPU ist nicht verfügbar</h2>
        <p>{gpu.reason}</p>
        <p>Blur &amp; Layer Studio rendert ausschließlich mit WebGPU. So beheben Sie das meist:</p>
        <ul>
          <li>Aktuelles Google Chrome (ab Version 113) verwenden.</li>
          <li>
            <code>chrome://gpu</code> öffnen und prüfen, ob „WebGPU: Hardware accelerated“ angezeigt wird.
          </li>
          <li>Unter Einstellungen → System die Hardwarebeschleunigung aktivieren.</li>
        </ul>
        {gpu.webgl2 && (
          <p className="muted">
            WebGL2 wäre verfügbar, ein eingeschränkter WebGL2-Modus ist derzeit aber nicht eingebaut.
          </p>
        )}
      </div>
    </div>
  );
}
