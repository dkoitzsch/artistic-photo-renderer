// PSD-Export (ag-psd): Ebenen als Pixel-Ebenen, Gruppen als PSD-Gruppen (auch mit Effekten), Deckkraft und Mischmodi
// übernommen, Ebenenmasken (deaktiviert, da schon in den Pixeln), Gruppenmasken (aktiv), Schatten als eigene Ebenen,
// optional unbearbeitete Originale als ausgeblendete Ebenen.
//
// Option „Effekte als eigene Ebenen“ (Spec „Effekte“ Abschnitt 9): Jede Ebene mit Effekten wird zur PSD-Gruppe aus
// Basisebene und je einer gerasterten Ebene pro Effekt (Name = Effektname). Eine Effekt-Ebene zeigt das reine
// Effektergebnis auf ihrem Eingang; Stärke → Deckkraft, Mischmodus → Mischmodus, Effektmaske → Ebenenmaske (aktiv).
// So ergibt die PSD dasselbe Bild wie die App (bis auf die 8-Bit-Mischung in sRGB).

import { writePsdUint8Array, type BlendMode as PsdBlend, type Layer as PsdLayer, type Psd } from 'ag-psd';
import { effectReach } from '../effects/reach';
import { getPlugin } from '../effects/pluginStore';
import { projectReach } from '../render/compositor';
import type { Engine } from '../render/engine';
import type {
  BlendMode,
  EffectInstance,
  EffectMask,
  Group,
  Layer,
  Project,
  SceneNode,
} from '../state/project';

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

export type PsdOptions = {
  includeOriginals: boolean;
  /** jeder Effekt als eigene gerasterte Ebene (statt eingebrannt) */
  effectsAsLayers?: boolean;
  onProgress?: (done: number, total: number) => void;
};

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
  const { mask: _m, ...rootWithoutMask } = root;
  return { ...project, root: rootWithoutMask };
}

function imageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  // ag-psd braucht im Browser echte ImageData-Objekte (putImageData)
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
}

function grayToRgba(gray: Uint8Array, width: number, height: number): ImageData {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) out.set([gray[i] ?? 0, gray[i] ?? 0, gray[i] ?? 0, 255], i * 4);
  return new ImageData(out, width, height);
}

const effectName = (fx: EffectInstance) => getPlugin(fx.effectId)?.manifest?.name ?? fx.effectId;

/** Effekt als reines Ergebnis (volle Stärke, normal, ohne eigene Maske, ganze Fläche). */
function rawEffect(fx: EffectInstance): EffectInstance {
  const { mask: _m, blendMode: _b, ...rest } = fx;
  return { ...rest, strength: 1, region: 'whole', enabled: true };
}

function withoutMask<T extends { mask?: unknown }>(n: T): Omit<T, 'mask'> {
  const { mask: _m, ...rest } = n;
  return rest;
}

export async function renderPsd(engine: Engine, project: Project, opts: PsdOptions): Promise<Uint8Array> {
  const { width, height } = project.canvas;
  const asLayers = opts.effectsAsLayers === true;
  const enabled = (list: EffectInstance[]) => list.filter((e) => e.enabled);

  // Fortschritt: Anzahl der Render-Durchläufe vorab zählen
  let total = 1;
  const count = (n: SceneNode) => {
    const fx = enabled(n.effects).length;
    if (n.kind === 'layer') total += 1 + (n.shadow ? 1 : 0) + (asLayers ? fx : 0);
    else {
      total += asLayers ? fx : fx ? 1 : 0;
      n.children.forEach(count);
    }
  };
  project.root.children.forEach(count);
  let done = 0;
  const tick = () => {
    opts.onProgress?.(++done, total);
  };

  async function pixels(p: Project): Promise<Uint8ClampedArray> {
    const px = await engine.renderFull(
      p,
      projectReach(p.root, (fx) => effectReach(fx, p.canvas)),
    );
    tick();
    return px;
  }

  async function maskOf(
    mask: EffectMask | undefined,
    hostLayerId: string | null,
    input?: { project: Project; group: Group },
  ) {
    if (!mask) return undefined;
    const gray = await engine.maskPixels(project, mask, hostLayerId, input);
    if (!gray) return undefined;
    return {
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      defaultColor: 0,
      disabled: false,
      imageData: grayToRgba(gray, width, height),
    };
  }

  /** Effekt-Ebenen eines Trägers: Eingang = Träger mit den Effekten davor; Ergebnis = reiner Effekt darauf. */
  async function effectLayers(host: Layer | Group, hostLayerId: string | null): Promise<PsdLayer[]> {
    const list = enabled(host.effects);
    const out: PsdLayer[] = [];
    for (let k = 0; k < list.length; k++) {
      const fx = list[k];
      if (!fx) continue;
      const before = list.slice(0, k);
      // Gruppen ohne ihre Maske rendern (die wirkt in der PSD über die Gruppe); Ebenen behalten ihre Ebenenmaske
      const bare = (host.kind === 'group' ? withoutMask(host) : host) as SceneNode;
      const raw = await pixels(solo(project, { ...bare, effects: [...before, rawEffect(fx)] }));
      const input =
        host.kind === 'group'
          ? { project: solo(project, { ...bare, effects: before }), group: host }
          : undefined;
      const mask = await maskOf(fx.mask, hostLayerId, input);
      out.push({
        name: effectName(fx),
        imageData: imageData(raw, width, height),
        opacity: fx.strength,
        blendMode: BLEND[fx.blendMode ?? 'normal'],
        ...(mask ? { mask } : {}),
      });
    }
    return out;
  }

  async function layer(l: Layer): Promise<PsdLayer[]> {
    const out: PsdLayer[] = [];
    if (l.shadow) {
      // Schatten allein: Ebene unsichtbar, Schatten mit voller Deckkraft (Deckkraft/Mischmodus als PSD-Werte)
      const shadowOnly: Layer = {
        ...l,
        opacity: 0,
        shadow: { ...l.shadow, opacity: 1, blendMode: 'normal', visible: true },
      };
      const data = await pixels(solo(project, shadowOnly));
      out.push({
        name: `${l.name} – Schatten`,
        imageData: imageData(data, width, height),
        opacity: l.shadow.opacity,
        blendMode: BLEND[l.shadow.blendMode],
        hidden: !l.visible || !l.shadow.visible,
      });
    }
    const { shadow: _s, ...rest } = l;
    const layerMask = await engine.layerMask(project, l.id);
    // Die Ebenenmaske steckt bereits in den Pixeln; als deaktivierte Maske bleibt sie zum Nachbearbeiten erhalten.
    const disabledMask = layerMask
      ? {
          mask: {
            top: 0,
            left: 0,
            bottom: height,
            right: width,
            defaultColor: 0,
            disabled: true,
            imageData: grayToRgba(layerMask, width, height),
          },
        }
      : {};
    const fxList = enabled(l.effects);
    if (asLayers && fxList.length > 0) {
      const base = await pixels(solo(project, { ...rest, effects: [] }));
      const fxLayers = await effectLayers(rest, l.id);
      out.push({
        name: l.name,
        opened: false,
        opacity: l.opacity,
        blendMode: BLEND[l.blendMode],
        hidden: !l.visible,
        children: [{ name: l.name, imageData: imageData(base, width, height), ...disabledMask }, ...fxLayers],
      });
      return out;
    }
    const data = await pixels(solo(project, rest));
    out.push({
      name: l.name,
      imageData: imageData(data, width, height),
      opacity: l.opacity,
      blendMode: BLEND[l.blendMode],
      hidden: !l.visible,
      ...disabledMask,
    });
    return out;
  }

  /** Gruppe → PSD-Gruppe: Kinder, darüber die Gruppeneffekte (gerendert bzw. je Effekt), Gruppenmaske aktiv. */
  async function group(g: Group, isRoot: boolean): Promise<PsdLayer[]> {
    const children: PsdLayer[] = [];
    for (const c of g.children) children.push(...(await node(c)));
    const fxList = enabled(g.effects);
    if (fxList.length > 0) {
      if (asLayers) children.push(...(await effectLayers(g, null)));
      else {
        // Gruppeneffekte gibt es in PSD nicht → Ergebnis der Gruppe (ohne Maske) als oberste Ebene der Gruppe.
        // Die Kinder bleiben zum Bearbeiten erhalten, werden aber ausgeblendet (das Ergebnis ersetzt sie, auch dort,
        // wo es halbtransparent ist).
        const data = await pixels(solo(project, withoutMask(g)));
        for (const c of children) c.hidden = true;
        children.push({
          name: `${g.name} – ${fxList.map(effectName).join(', ')} (gerendert)`,
          imageData: imageData(data, width, height),
        });
      }
    }
    const mask = await maskOf(
      g.mask,
      null,
      g.mask ? { project: solo(project, { ...withoutMask(g), effects: [] }), group: g } : undefined,
    );
    // Wurzel: nur als Gruppe ausgeben, wenn sie Maske, Deckkraft oder Mischmodus braucht
    if (isRoot && !mask && g.opacity >= 1 && g.blendMode === 'normal') return children;
    return [
      {
        name: g.name,
        children,
        opened: true,
        opacity: g.opacity,
        blendMode: BLEND[g.blendMode],
        hidden: !g.visible,
        ...(mask ? { mask } : {}),
      },
    ];
  }

  async function node(n: SceneNode): Promise<PsdLayer[]> {
    return n.kind === 'layer' ? layer(n) : group(n, false);
  }

  const layers: PsdLayer[] = [];
  if (opts.includeOriginals) {
    const originals: PsdLayer[] = [];
    for (const o of Object.values(project.originals)) {
      const clean: Layer = {
        kind: 'layer',
        id: `orig-${o.id}`,
        name: o.fileName,
        originalId: o.id,
        mask: { kind: 'full' },
        maskSource: 'full',
        maskEdge: { hardness: 4, offset: 0, curve: 'linear' },
        holeFill: false,
        transform: project.root.children.find((c): c is Layer => c.kind === 'layer' && c.originalId === o.id)
          ?.transform ?? { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        effects: [],
      };
      const data = await pixels(solo(project, clean));
      originals.push({
        name: `Original: ${o.fileName}`,
        imageData: imageData(data, width, height),
        hidden: true,
      });
    }
    layers.push({ name: 'Originale', children: originals, opened: false, hidden: true });
  }
  layers.push(...(await group(project.root, true)));

  // Zusammengesetztes Bild für Vorschau/Programme ohne Ebenenunterstützung
  const composite = await pixels(project);
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
