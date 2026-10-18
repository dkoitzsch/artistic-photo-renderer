// Beamer-Fenster des Malplans (Spec 7.7): schwarzer Hintergrund, eine Hilfe im Vollbild, Trapezkorrektur über vier
// ziehbare Ecken. Das Bild kommt vom Hauptfenster über einen BroadcastChannel; Ecken gehen zurück ins Projekt.
// F = Vollbild, R = Ecken zurücksetzen; die Hinweise blenden sich nach 3 s ohne Mausbewegung aus.

import { StrictMode, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import { BEAMER_CHANNEL, isDefaultCorners, type BeamerMessage, type Corners } from './malplan/beamerChannel';
import { fitCorners, rectToQuad, toMatrix3d } from './malplan/homography';

type Shown = { url: string; aspect: number; label: string; width: number; height: number };

function Beamer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [size, setSize] = useState<[number, number]>([window.innerWidth, window.innerHeight]);
  const [hints, setHints] = useState(true);
  const channel = useRef<BroadcastChannel | null>(null);
  const drag = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(BEAMER_CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<BeamerMessage>) => {
      const msg = e.data;
      if (msg.type !== 'image') return;
      const url = URL.createObjectURL(msg.png);
      const img = new Image();
      img.onload = () => {
        setShown((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return {
            url,
            aspect: msg.aspect,
            label: msg.label,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
        });
        setCorners(isDefaultCorners(msg.corners) ? null : msg.corners);
      };
      img.src = url;
    };
    ch.postMessage({ type: 'hello' } satisfies BeamerMessage);
    const onResize = () => {
      setSize([window.innerWidth, window.innerHeight]);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      ch.close();
    };
  }, []);

  const pokeHints = () => {
    setHints(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setHints(false);
    }, 3000);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      } else if (e.key === 'r' || e.key === 'R') {
        setCorners(null);
        channel.current?.postMessage({
          type: 'corners',
          corners: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        } satisfies BeamerMessage);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const [vw, vh] = size;
  const quad: Corners = corners ?? (shown ? fitCorners(shown.aspect, vw, vh) : fitCorners(1, vw, vh));
  const px = quad.map(([x, y]) => [x * vw, y * vh] as const) as unknown as Corners;
  const transform = shown ? toMatrix3d(rectToQuad(shown.width, shown.height, px)) : '';

  const onDown = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = i;
    if (!corners) setCorners(quad);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    pokeHints();
    const i = drag.current;
    if (i === null) return;
    const next = [...quad] as Corners;
    next[i] = [Math.min(1, Math.max(0, e.clientX / vw)), Math.min(1, Math.max(0, e.clientY / vh))];
    setCorners(next);
  };
  const onUp = () => {
    if (drag.current === null) return;
    drag.current = null;
    if (corners) channel.current?.postMessage({ type: 'corners', corners } satisfies BeamerMessage);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, cursor: hints ? 'default' : 'none' }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      data-testid="beamer"
    >
      {shown ? (
        <img
          src={shown.url}
          alt={shown.label}
          data-testid="beamer-image"
          draggable={false}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: shown.width,
            height: shown.height,
            transformOrigin: '0 0',
            transform,
            userSelect: 'none',
          }}
        />
      ) : (
        <p style={{ color: '#888', font: '16px "Inter Variable", sans-serif', padding: 24 }}>
          Warte auf das Bild aus dem Malplan …
        </p>
      )}
      {hints &&
        px.map(([x, y], i) => (
          <div
            key={i}
            data-testid={`beamer-corner-${i}`}
            onPointerDown={onDown(i)}
            style={{
              position: 'absolute',
              left: x - 11,
              top: y - 11,
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2px solid #4f7cff',
              background: 'rgba(79,124,255,0.25)',
              cursor: 'grab',
              touchAction: 'none',
            }}
          />
        ))}
      {hints && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 12px',
            borderRadius: 8,
            background: 'rgba(30,30,34,0.85)',
            color: '#ddd',
            font: '13px "Inter Variable", system-ui, sans-serif',
          }}
        >
          {shown?.label ?? 'Malplan'} · Ecken ziehen = Trapezkorrektur · F = Vollbild · R = Ecken zurücksetzen
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');
createRoot(root).render(
  <StrictMode>
    <Beamer />
  </StrictMode>,
);
