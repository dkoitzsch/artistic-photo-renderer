import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { importImageAsLayer, openFile } from '../../io/import';
import { PROJECT_EXTENSION } from '../../io/projectFile';
import { openFileDialog } from '../../io/openDialog';
import { parseHexColor, srgbToLinear } from '../../render/color';
import type { ViewColors } from '../../render/engine';
import { getEngine } from '../../render/runtime';
import { useAppStore, useProject } from '../../state/store';
import { panBy, zoomBy } from '../../state/viewActions';
import { usePluginStore } from '../../effects/pluginStore';
import { FocusOverlay } from './FocusOverlay';
import { TransformOverlay } from './TransformOverlay';
import { ParallaxPanel, parallaxVector } from './ParallaxPanel';
import { AnalysisPanel } from './AnalysisPanel';
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

/** Abgelegte Dateien: Projektdatei oder Bild ohne offenes Projekt → öffnen; sonst Bilder als neue Ebenen. */
async function dropFiles(files: File[]): Promise<void> {
  const first = files[0];
  if (!first) return;
  if (first.name.toLowerCase().endsWith(PROJECT_EXTENSION) || !useAppStore.getState().history) {
    await openFile(first);
    return;
  }
  for (const f of files) await importImageAsLayer(f);
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
  const project = useProject();
  const image = project;
  const compareSplit = useAppStore((s) => s.compareSplit);
  const setCompareSplit = useAppStore((s) => s.setCompareSplit);
  const plugins = usePluginStore((s) => s.plugins);
  const viewMode = useAppStore((s) => s.viewMode);
  const parallax = useAppStore((s) => s.parallax);
  const analysisView = useAppStore((s) => s.analysisView);
  const selectedId = useAppStore((s) => s.selectedNodeId);
  const view = useAppStore((s) => s.view);
  const viewport = useAppStore((s) => s.viewport);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Leinwand an den Renderer koppeln.
  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = getEngine();
    if (!gpuReady || !canvas || !engine) return;
    engine.attachCanvas(canvas);
    return () => {
      engine.detachCanvas();
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

  // Neu rendern/zeichnen, wenn sich Projekt, Plugins, Ansicht oder Theme ändern (zusammengefasst pro Frame).
  useEffect(() => {
    if (!gpuReady) return;
    const id = requestAnimationFrame(() => {
      const splitX = compareSplit === null ? null : compareSplit * viewport.width;
      const overlay =
        viewMode === 'result' || !selectedId
          ? null
          : viewMode === 'analysis'
            ? { layerId: selectedId, kind: analysisView.map, opacity: analysisView.opacity }
            : { layerId: selectedId, kind: viewMode };
      const px = project ? parallaxVector(parallax, project.canvas) : null;
      getEngine()?.present(
        project,
        view,
        window.devicePixelRatio || 1,
        readViewColors(),
        splitX,
        overlay,
        px,
      );
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [
    gpuReady,
    project,
    plugins,
    view,
    viewport,
    theme,
    compareSplit,
    viewMode,
    selectedId,
    parallax,
    analysisView,
  ]);

  // Mausrad/Trackpad: Pinch bzw. ⌘/Strg + Rad zoomt um den Cursor, sonst verschieben.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!useAppStore.getState().history) return;
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
    if (parallax.enabled) {
      const r = e.currentTarget.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
      useAppStore
        .getState()
        .setParallax({ pointer: [Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny))] });
    }
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
      className={`canvas-area${dragOver ? ' drag-over' : ''}${spaceDown || panning ? ' space-pan' : ''}`}
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
        void dropFiles([...e.dataTransfer.files]);
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
        onPointerLeave={() => {
          if (useAppStore.getState().parallax.enabled)
            useAppStore.getState().setParallax({ pointer: [0, 0] });
        }}
        onAuxClick={(e) => {
          e.preventDefault();
        }}
      />
      {gpuReady && !image && (
        <div className="empty-state">
          <p className="empty-title">Bild hierher ziehen</p>
          <p className="empty-sub">JPEG, PNG, WebP oder Projektdatei (.blurstudio)</p>
          <button className="button" onClick={openFileDialog} data-testid="open-button">
            Datei öffnen …
          </button>
        </div>
      )}
      {image && compareSplit !== null && (
        <CompareHandle
          x={compareSplit * viewport.width}
          onMove={(x) => {
            setCompareSplit(Math.min(1, Math.max(0, x / viewport.width)));
          }}
        />
      )}
      <TransformOverlay />
      <FocusOverlay />
      <ParallaxPanel />
      <AnalysisPanel />
      <GpuStatus />
    </div>
  );
}

function CompareHandle({ x, onMove }: { x: number; onMove: (x: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      ref={ref}
      className={`compare-handle${drag ? ' dragging' : ''}`}
      style={{ left: x }}
      data-testid="compare-handle"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
      }}
      onPointerMove={(e) => {
        const parent = ref.current?.parentElement;
        if (!drag || !parent) return;
        onMove(e.clientX - parent.getBoundingClientRect().left);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDrag(false);
      }}
    >
      <span className="compare-label left">Vorher</span>
      <span className="compare-grip" />
      <span className="compare-label right">Nachher</span>
    </div>
  );
}
