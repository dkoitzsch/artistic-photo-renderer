// PSD-Export (ag-psd): jede Ebene mit angewendeten Effekten als Pixel-Ebene, Gruppen als PSD-Gruppen,
// Deckkraft und Mischmodi übernommen, Masken als (deaktivierte) Ebenenmasken, Schatten als eigene Ebenen,
// optional die unbearbeiteten Originale als ausgeblendete Ebenen.

import { writePsdUint8Array, type BlendMode as PsdBlend, type Layer as PsdLayer, type Psd } from 'ag-psd';
import { effectReach } from '../effects/reach';
import { projectReach } from '../render/compositor';
import type { Engine } from '../render/engine';
import type { BlendMode, Group, Layer, Project, SceneNode } from '../state/project';

const BLEND: Record<BlendMode, PsdBlend> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'soft light',
  lighten: 'lighten',
  darken: 'darken',
  difference: 'difference',
};

export type PsdOptions = { includeOriginals: boolean; onProgress?: (done: number, total: number) => void };

/** Projekt, das nur diesen Knoten zeigt (sichtbar, volle Deckkraft, normal gemischt). */
function solo(project: Project, node: SceneNode): Project {
  const shown = { ...node, visible: true, opacity: 1, blendMode: 'normal' } as SceneNode;
  const root: Group = {
    ...project.root,
    children: [shown],
    effects: [],
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
  return { ...project, root };
}

async function pixels(engine: Engine, project: Project): Promise<Uint8ClampedArray> {
  return engine.renderFull(
    project,
    projectReach(project.root, (fx) => effectReach(fx, project.canvas)),
  );
}

// ag-psd braucht im Browser echte ImageData-Objekte (putImageData)
function imageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
}

function grayToRgba(gray: Uint8Array, width: number, height: number) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) out.set([gray[i] ?? 0, gray[i] ?? 0, gray[i] ?? 0, 255], i * 4);
  return new ImageData(out, width, height);
}

export async function renderPsd(engine: Engine, project: Project, opts: PsdOptions): Promise<Uint8Array> {
  const { width, height } = project.canvas;
  let total = 0;
  const count = (n: SceneNode) => {
    total += n.kind === 'layer' ? 1 + (n.shadow ? 1 : 0) : n.effects.some((e) => e.enabled) ? 1 : 0;
    if (n.kind === 'group' && !n.effects.some((e) => e.enabled)) n.children.forEach(count);
  };
  project.root.children.forEach(count);
  let done = 0;
  const tick = () => {
    opts.onProgress?.(++done, total);
  };

  async function layer(l: Layer): Promise<PsdLayer[]> {
    const out: PsdLayer[] = [];
    if (l.shadow) {
      // Schatten allein: Ebene unsichtbar, Schatten mit voller Deckkraft (Deckkraft/Mischmodus als PSD-Werte)
      const shadowOnly: Layer = {
        ...l,
        opacity: 0,
        shadow: { ...l.shadow, opacity: 1, blendMode: 'normal', visible: true },
      };
      const data = await pixels(engine, solo(project, shadowOnly));
      out.push({
        name: `${l.name} – Schatten`,
        imageData: imageData(data, width, height),
        opacity: l.shadow.opacity,
        blendMode: BLEND[l.shadow.blendMode],
        hidden: !l.visible || !l.shadow.visible,
      });
      tick();
    }
    const { shadow: _s, ...rest } = l;
    const data = await pixels(engine, solo(project, rest));
    const mask = await engine.layerMask(project, l.id);
    out.push({
      name: l.name,
      imageData: imageData(data, width, height),
      opacity: l.opacity,
      blendMode: BLEND[l.blendMode],
      hidden: !l.visible,
      // Die Maske ist bereits in den Pixeln enthalten; als deaktivierte Ebenenmaske bleibt sie zum Nachbearbeiten erhalten.
      ...(mask
        ? {
            mask: {
              top: 0,
              left: 0,
              bottom: height,
              right: width,
              defaultColor: 0,
              disabled: true,
              imageData: grayToRgba(mask, width, height),
            },
          }
        : {}),
    });
    tick();
    return out;
  }

  async function node(n: SceneNode): Promise<PsdLayer[]> {
    if (n.kind === 'layer') return layer(n);
    if (n.effects.some((e) => e.enabled)) {
      // Gruppeneffekte gibt es in PSD nicht → Gruppe als eine gerenderte Ebene
      const data = await pixels(engine, solo(project, n));
      tick();
      return [
        {
          name: `${n.name} (gerendert)`,
          imageData: imageData(data, width, height),
          opacity: n.opacity,
          blendMode: BLEND[n.blendMode],
          hidden: !n.visible,
        },
      ];
    }
    const children: PsdLayer[] = [];
    for (const c of n.children) children.push(...(await node(c)));
    return [
      {
        name: n.name,
        children,
        opened: true,
        opacity: n.opacity,
        blendMode: BLEND[n.blendMode],
        hidden: !n.visible,
      },
    ];
  }

  const layers: PsdLayer[] = [];
  if (opts.includeOriginals) {
    const originals: PsdLayer[] = [];
    for (const o of Object.values(project.originals)) {
      const l = project.root.children.find((c): c is Layer => c.kind === 'layer' && c.originalId === o.id);
      const original: Layer = l ?? {
        kind: 'layer',
        id: `orig-${o.id}`,
        name: o.fileName,
        originalId: o.id,
        mask: { kind: 'full' },
        maskSource: 'full',
        maskEdge: { hardness: 4, offset: 0, curve: 'linear' },
        holeFill: false,
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        effects: [],
      };
      const { focusMap: _f, shadow: _sh, ...rest } = original;
      const clean: Layer = { ...rest, mask: { kind: 'full' }, holeFill: false, effects: [] };
      const data = await pixels(engine, solo(project, clean));
      originals.push({
        name: `Original: ${o.fileName}`,
        imageData: imageData(data, width, height),
        hidden: true,
      });
    }
    layers.push({ name: 'Originale', children: originals, opened: false, hidden: true });
  }
  if (project.root.effects.some((e) => e.enabled)) {
    const data = await pixels(engine, project);
    layers.push({ name: 'Gesamtbild (gerendert)', imageData: imageData(data, width, height) });
  } else {
    for (const c of project.root.children) layers.push(...(await node(c)));
  }

  // Zusammengesetztes Bild für Vorschau/Programme ohne Ebenenunterstützung
  const composite = await pixels(engine, project);
  const psd: Psd = {
    width,
    height,
    channels: 3,
    bitsPerChannel: 8,
    imageData: imageData(composite, width, height),
    children: layers,
  };
  return writePsdUint8Array(psd, { generateThumbnail: true, trimImageData: false });
}
