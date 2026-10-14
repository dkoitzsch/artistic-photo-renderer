import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { importImageFile } from '../../io/import';
import { openImageDialog } from '../../io/openDialog';
import { parseHexColor, srgbToLinear } from '../../render/color';
import type { ViewColors } from '../../render/renderer';
import { getRenderer } from '../../render/runtime';
import { useAppStore } from '../../state/store';
import { panBy, zoomBy } from '../../state/viewActions';
import { GpuStatus } from './GpuStatus';

function cssColorLinear(style: CSSStyleDeclaration, name: string): [number, number, number] {
  const [r, g, b] = parseHexColor(style.getPropertyValue(name));
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function readViewColors(): ViewColors {
  const style = getComputedStyle(document.documentElement);
  return {
    background: cssColorLinear(style, '--canvas-bg'),
    checkerA: cssColorLinear(style, '--checker-a'),
    checkerB: cssColorLinear(style, '--checker-b'),
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function CanvasView({ theme }: { theme: 'light' | 'dark' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuReady = useAppStore((s) => s.gpu.state === 'ready');
  const image = useAppStore((s) => s.image);
  const view = useAppStore((s) => s.view);
  const viewport = useAppStore((s) => s.viewport);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Leinwand an den Renderer koppeln.
  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = getRenderer();
    if (!gpuReady || !canvas || !renderer) return;
    renderer.attachCanvas(canvas);
    return () => {
      renderer.detachCanvas();
    };
  }, [gpuReady]);

  // Größe der Leinwand in Geräte-Pixeln nachführen.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      useAppStore.getState().setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Neu zeichnen, wenn sich Ansicht, Bild oder Theme ändern (zusammengefasst pro Frame).
  useEffect(() => {
    if (!gpuReady) return;
    const id = requestAnimationFrame(() => {
      getRenderer()?.drawView(view, window.devicePixelRatio || 1, readViewColors());
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [gpuReady, view, viewport, image, theme]);

  // Mausrad/Trackpad: Pinch bzw. ⌘/Strg + Rad zoomt um den Cursor, sonst verschieben.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!useAppStore.getState().image) return;
      const rect = canvas.getBoundingClientRect();
      const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const delta = Math.max(-25, Math.min(25, e.deltaY * scale));
        zoomBy(Math.exp(-delta * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        panBy(-e.deltaX * scale, -e.deltaY * scale);
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Leertaste hält die Hand.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditableTarget(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    const blur = () => {
      setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (panning) panBy(e.movementX, e.movementY);
  };
  const endPan = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!panning) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPanning(false);
  };

  const cursor = panning ? 'grabbing' : spaceDown && image ? 'grab' : 'default';

  return (
    <div
      ref={containerRef}
      className={`canvas-area${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (!gpuReady) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={() => {
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void importImageFile(file);
      }}
    >
      <canvas
        ref={canvasRef}
        className="canvas"
        data-testid="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onAuxClick={(e) => {
          e.preventDefault();
        }}
      />
      {gpuReady && !image && (
        <div className="empty-state">
          <p className="empty-title">Bild hierher ziehen</p>
          <p className="empty-sub">JPEG, PNG oder WebP</p>
          <button className="button" onClick={openImageDialog} data-testid="open-button">
            Bild öffnen …
          </button>
        </div>
      )}
      <GpuStatus />
    </div>
  );
}
