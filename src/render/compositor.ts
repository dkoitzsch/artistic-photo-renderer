// Rendert den Projektbaum (hinten → vorn) in eine Textur. Für die Vorschau werden Zwischenergebnisse
// pro Layer und Effektschritt gecacht (Schlüssel aus Eingang + Parametern); nur Geändertes wird neu berechnet.

import { defaultParams } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import {
  findNode,
  walk,
  type BlendMode,
  type EffectInstance,
  type EffectMask,
  type Group,
  type Layer,
  type OriginalRef,
  type Project,
  type SceneNode,
} from '../state/project';
import { apply, invert, isAligned, placement, type Affine } from '../state/transform';
import type { GpuCore } from './core';
import type { EffectRunner } from './effectRunner';
import type { AsyncEffects } from './asyncEffects';
import type { SourceStore } from './sources';
import type { Frame, TexturePool } from './texturePool';

export type Rect = { x: number; y: number; width: number; height: number };

export type RenderOptions = {
  /** Render-px pro Leinwand-px (Vorschau < 1, Export = 1) */
  scale: number;
  /** Leinwandgröße in Render-px */
  canvasSize: [number, number];
  /** Ausschnitt in Render-px */
  region: Rect;
  /** "Vorher"-Ansicht: alle Effekte aus */
  ignoreEffects: boolean;
  /** Parallax-Vorschau: Versatz in Render-px je Einheit (0,5 − Tiefe); nur Ebenen mit Tiefe */
  parallax?: [number, number];
  cache: ResultCache | null;
  /** trennt Cache-Einträge (z. B. "after" / "before") */
  variant: string;
  /** Endrender (Export): Effekte nutzen ihre "final"-Ausführung statt "preview" */
  final?: boolean;
};

export type RenderResult = { tex: GPUTexture; key: string; owned: boolean };

/** Hält Ergebnistexturen pro Slot; nicht mehr benutzte Slots werden am Frame-Ende freigegeben. */
export class ResultCache {
  private readonly entries = new Map<string, { key: string; tex: GPUTexture }>();
  private readonly touched = new Set<string>();

  constructor(private readonly pool: TexturePool) {}

  get(slot: string, key: string): GPUTexture | undefined {
    const e = this.entries.get(slot);
    if (e?.key !== key) return undefined;
    this.touched.add(slot);
    return e.tex;
  }

  set(slot: string, key: string, tex: GPUTexture): void {
    const old = this.entries.get(slot);
    if (old && old.tex !== tex) this.pool.release(old.tex);
    this.entries.set(slot, { key, tex });
    this.touched.add(slot);
  }

  beginFrame(): void {
    this.touched.clear();
  }

  endFrame(): void {
    for (const [slot, e] of this.entries)
      if (!this.touched.has(slot)) {
        this.pool.release(e.tex);
        this.entries.delete(slot);
      }
  }

  clear(): void {
    for (const e of this.entries.values()) this.pool.release(e.tex);
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

function findLayer(project: Project, id: string): Layer | undefined {
  const n = findNode(project.root, id);
  return n?.kind === 'layer' ? n : undefined;
}

/** Die Ebene selbst oder (bei einer Gruppe) die erste sichtbare Unterebene. */
function findFirstLayer(project: Project, id: string): Layer | undefined {
  const n = findNode(project.root, id);
  if (!n) return undefined;
  if (n.kind === 'layer') return n;
  for (const c of walk(n)) if (c.kind === 'layer' && c.visible) return c;
  return undefined;
}

/** Ebene mit Tiefenkarte: die Ebene selbst oder (bei einer Gruppe) die erste Unterebene mit Tiefenkarte. */
function findDepthLayer(project: Project, id: string): Layer | undefined {
  const n = findNode(project.root, id);
  if (!n) return undefined;
  if (n.kind === 'layer') return n;
  for (const c of walk(n)) if (c.kind === 'layer' && c.depthMap) return c;
  return undefined;
}

const isWhole = (r: Rect, [w, h]: [number, number]) =>
  r.x === 0 && r.y === 0 && r.width === w && r.height === h;

/**
 * Lage einer Ebene: Sie wird in ihrem eigenen Raum (Pixel des Originals, Auflösung „local“) aufbereitet
 * (Maske, Lochfüllung, Tiefe) und dann auf die Leinwand gelegt. aligned: deckungsgleich mit der Leinwand
 * (Standardfall, ohne Neuabtastung).
 */
type Geometry = {
  aligned: boolean;
  /** Größe der Ebenen-Texturen */
  local: [number, number];
  /** Ebenen-Texel pro Original-px (für Masken-Kantenbreiten in px) */
  pxScale: number;
  /** Render-px → Ebenen-Texel */
  toLocal: Affine;
  /** Original-px → Leinwand-px */
  toCanvas: Affine;
  /** Betrag der Skalierung (Fokusradien) */
  scale: number;
  key: string;
};

/** Reichweite einer Kantenmaske (wie EDGE_MAP_REACH in effects/reach.ts). */
const EDGE_MASK_REACH = 8;

const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

type Aux = {
  mask: GPUTexture;
  focus: GPUTexture;
  depth: GPUTexture;
  hasFocus: boolean;
  luminance?: GPUTexture;
  edges?: GPUTexture;
};

/** Karten, die als Effektmaske bzw. Effekt-Eingang aus einer Ebene entstehen. */
type MapId = 'luminance' | 'edges' | 'depth';

/**
 * Lazy Zusatz-Eingänge einer Ebene: werden erst erzeugt, wenn ein Effekt wirklich rechnen muss.
 * need: angeforderte Analysekarten des Effekts (manifest.requires).
 */
type AuxProvider = { key: string; get: (need: readonly string[]) => Aux; release: () => void };

export class Compositor {
  /** Anzahl der in diesem Frame tatsächlich ausgeführten Effekte (für Tests/Statistik) */
  effectRuns = 0;

  /** Leinwand und Originale des gerade gerenderten Projekts (für die Lage der Ebenen) */
  private canvas: { width: number; height: number } = { width: 1, height: 1 };
  private originals: Record<string, OriginalRef> = {};
  private root: Group | null = null;

  /** Asynchrone Effekte, deren Ergebnis in diesem Durchlauf noch fehlte (Schlüssel) */
  missingAsync: string[] = [];

  constructor(
    private readonly core: GpuCore,
    private readonly sources: SourceStore,
    private readonly runner: EffectRunner,
    private readonly async: AsyncEffects,
  ) {}

  private use(project: Project): void {
    this.canvas = project.canvas;
    this.originals = project.originals;
    this.root = project.root;
  }

  /** Karte einer Ebene im Ebenenraum (Helligkeit des Originals oder Tiefenkarte), gecacht. */
  private layerMap(
    frame: Frame,
    layer: Layer,
    geo: Geometry,
    map: MapId,
  ): { tex: GPUTexture; key: string } | null {
    if (map === 'depth') return this.depthTexture(frame, layer, geo);
    const [lw, lh] = geo.local;
    const lumaKey = `luma|${layer.originalId}@${lw}x${lh}`;
    const luma = this.sources.derive(lumaKey, lw, lh, (out) => {
      this.core.luma(frame, this.sources.at(frame, layer.originalId, lw, lh), out);
    });
    if (map === 'luminance') return { tex: luma, key: lumaKey };
    const key = `edges|${layer.originalId}@${lw}x${lh}|ps${geo.pxScale.toFixed(5)}`;
    const tex = this.sources.derive(key, lw, lh, (out) => {
      this.core.edgeMap(frame, luma, geo.pxScale, out);
    });
    return { tex, key };
  }

  /** Analysekarten aus einem Bild im Leinwand-Ausschnitt (Effekte auf Gruppen: Karten aus ihrem Eingang). */
  private inputMaps(
    frame: Frame,
    src: GPUTexture,
    opts: RenderOptions,
    need: readonly string[],
    owned: GPUTexture[],
  ): { luminance?: GPUTexture; edges?: GPUTexture } {
    if (!need.includes('luminance') && !need.includes('edges')) return {};
    const luma = this.core.pool.acquire(src.width, src.height, 'input-luma');
    owned.push(luma);
    this.core.luma(frame, src, luma);
    if (!need.includes('edges')) return { luminance: luma };
    const edges = this.core.pool.acquire(src.width, src.height, 'input-edges');
    owned.push(edges);
    this.core.edgeMap(frame, luma, opts.scale, edges);
    return { luminance: luma, edges };
  }

  /**
   * Eigene Maske eines Effekts als Leinwand-Ausschnitt (lazy). host: Ebene des Effekts (für Kartenbereiche);
   * bei Gruppen null – dort wirken nur Masken anderer Ebenen. null = keine Maske.
   */
  private effectMask(
    frame: Frame,
    mask: EffectMask | undefined,
    host: { layer: Layer; geo: Geometry } | null,
    opts: RenderOptions,
    /** ohne Ebene (Gruppen): Bild, aus dem Helligkeit/Kanten stammen, und die Gruppe (für Tiefe) */
    source?: { input: RenderResult; group: Group },
  ): { key: string; get: () => { tex: GPUTexture; owned: boolean } } | null {
    if (!mask) return null;
    if (mask.kind === 'map' && !host && source) {
      if (mask.map === 'depth') {
        // Tiefe: von der ersten Ebene der Gruppe mit Tiefenkarte
        let depthLayer: Layer | undefined;
        for (const n of walk(source.group))
          if (n.kind === 'layer' && (n.depthMap || n.mask.kind === 'depth')) {
            depthLayer = n;
            break;
          }
        if (!depthLayer) return null;
        return this.effectMask(
          frame,
          mask,
          { layer: depthLayer, geo: this.geometry(depthLayer, opts) },
          opts,
        );
      }
      // Helligkeit/Kanten aus dem Eingangsbild (Leinwand-Ausschnitt)
      const { input } = source;
      const spec = `${mask.map}|${mask.from},${mask.to},${mask.feather},${mask.invert ? 'inv' : ''}`;
      return {
        key: `inmask|${input.key}|${spec}`,
        get: () => {
          const temps: GPUTexture[] = [];
          const maps = this.inputMaps(frame, input.tex, opts, [mask.map], temps);
          const map = mask.map === 'edges' ? maps.edges : maps.luminance;
          const out = this.core.pool.acquire(opts.region.width, opts.region.height, 'input-mask');
          if (map) this.core.mapRange(frame, map, mask.from, mask.to, mask.feather, mask.invert, out);
          else this.core.fill(frame, out, [1, 1, 1, 1]);
          for (const t of temps) this.core.pool.release(t);
          return { tex: out, owned: true };
        },
      };
    }
    if (mask.kind === 'map') {
      if (!host) return null;
      const { layer, geo } = host;
      const map = this.layerMap(frame, layer, geo, mask.map);
      if (!map) return null;
      const [lw, lh] = geo.local;
      const spec = `${mask.from},${mask.to},${mask.feather},${mask.invert ? 'inv' : ''}`;
      const key = `emask|${map.key.split('|')[1] ?? ''}@${lw}x${lh}|range${spec}`;
      return {
        key: `${key}${geo.key}`,
        get: () => {
          const local = this.sources.derive(key, lw, lh, (out) => {
            this.core.mapRange(frame, map.tex, mask.from, mask.to, mask.feather, mask.invert, out);
          });
          return this.place(frame, geo, local, opts, 'effect-mask');
        },
      };
    }
    const other = this.root ? findNode(this.root, mask.layerId) : undefined;
    if (other?.kind !== 'layer') return null;
    const geo = this.geometry(other, opts);
    const m = this.processedMask(frame, other, geo);
    const key = `layermask|${m?.key ?? 'full'}${geo.key}|${mask.invert ? 'inv' : ''}`;
    return {
      key,
      get: () => {
        const r = opts.region;
        let placed: { tex: GPUTexture; owned: boolean };
        if (m) placed = this.place(frame, geo, m.tex, opts, 'effect-mask');
        else {
          // Ebene ohne Maske: ihre ganze Bildfläche
          const ones = this.core.pool.acquire(geo.local[0], geo.local[1], 'ones');
          this.core.fill(frame, ones, [1, 1, 1, 1]);
          placed = this.place(frame, geo, ones, opts, 'effect-mask');
          if (placed.tex !== ones) this.core.pool.release(ones);
          else placed = { tex: ones, owned: true };
        }
        if (!mask.invert) return placed;
        const inv = this.core.pool.acquire(r.width, r.height, 'effect-mask-inv');
        this.core.loadMask(frame, placed.tex, inv, true);
        if (placed.owned) this.core.pool.release(placed.tex);
        return { tex: inv, owned: true };
      },
    };
  }

  /** Lage einer Ebene für diese Render-Auflösung. */
  private geometry(layer: Layer, opts: RenderOptions): Geometry {
    const o = this.originals[layer.originalId];
    const t = layer.transform;
    if (!o || isAligned(t, o, this.canvas)) {
      return {
        aligned: true,
        local: opts.canvasSize,
        pxScale: opts.scale,
        toLocal: IDENTITY_AFFINE,
        toCanvas: IDENTITY_AFFINE,
        scale: 1,
        key: '',
      };
    }
    const scale = Math.abs(t.scale);
    // Auflösung der Ebene: so fein wie nötig, in Viertel-Oktaven gestuft (stabile Caches beim Skalieren)
    const f = Math.min(1, 2 ** (Math.ceil(4 * Math.log2(Math.max(1e-4, opts.scale * scale))) / 4));
    const lw = Math.max(1, Math.round(o.width * f));
    const lh = Math.max(1, Math.round(o.height * f));
    const toCanvas = placement(t, o, this.canvas);
    const inv = invert(toCanvas);
    const fx = lw / o.width;
    const fy = lh / o.height;
    const k = 1 / opts.scale;
    const toLocal: Affine = {
      a: fx * inv.a * k,
      b: fy * inv.b * k,
      c: fx * inv.c * k,
      d: fy * inv.d * k,
      e: fx * inv.e,
      f: fy * inv.f,
    };
    const m = [toCanvas.a, toCanvas.b, toCanvas.c, toCanvas.d, toCanvas.e, toCanvas.f].map((v) =>
      v.toFixed(5),
    );
    return {
      aligned: false,
      local: [lw, lh],
      pxScale: fx,
      toLocal,
      toCanvas,
      scale,
      key: `|T${m.join(',')}`,
    };
  }

  /** Legt eine Ebenen-Textur auf den Leinwand-Ausschnitt (ausgerichtet: Ausschnitt kopieren, sonst neu abtasten). */
  private place(
    frame: Frame,
    geo: Geometry,
    tex: GPUTexture,
    opts: RenderOptions,
    label: string,
  ): { tex: GPUTexture; owned: boolean } {
    if (geo.aligned) return this.region(frame, tex, opts, label);
    const r = opts.region;
    const out = this.core.pool.acquire(r.width, r.height, label);
    this.core.warp(frame, tex, out, geo.toLocal, [r.x, r.y]);
    return { tex: out, owned: true };
  }

  /**
   * Original als Zweitbild eines Effekts, so fein wie nötig: Es füllt die Leinwand („cover“); die Auflösung folgt der
   * Render-Skalierung (Viertel-Oktaven-Stufen wie bei Ebenen).
   */
  private imageTexture(frame: Frame, id: string, opts: RenderOptions): GPUTexture | null {
    const o = this.originals[id];
    if (!o || !this.sources.has(id)) return null;
    const cover = Math.max(this.canvas.width / o.width, this.canvas.height / o.height);
    const f = Math.min(1, 2 ** (Math.ceil(4 * Math.log2(Math.max(1e-4, opts.scale * cover))) / 4));
    return this.sources.at(
      frame,
      id,
      Math.max(1, Math.round(o.width * f)),
      Math.max(1, Math.round(o.height * f)),
    );
  }

  /** Fokuspunkte einer Ebene in Leinwand-px. */
  private focusPoints(layer: Layer, geo: Geometry) {
    const points = (layer.focusMap?.points ?? []).filter((p) => p.enabled && p.radius > 0);
    if (geo.aligned) return points;
    return points.map((p) => {
      const [x, y] = apply(geo.toCanvas, p.x, p.y);
      return { ...p, x, y, radius: p.radius * geo.scale };
    });
  }

  render(frame: Frame, project: Project, opts: RenderOptions): RenderResult {
    this.use(project);
    this.missingAsync = [];
    const res = this.node(frame, project.root, opts);
    if (res) return res;
    const tex = this.core.pool.acquire(opts.region.width, opts.region.height, 'empty');
    this.core.fill(frame, tex, [0, 0, 0, 0]);
    return { tex, key: 'empty', owned: true };
  }

  /** Prüfansicht einer Ebene: aufbereitete Maske oder Fokuskarte (Leinwand-Ausschnitt in Render-px). */
  overlay(
    frame: Frame,
    project: Project,
    layerId: string,
    kind: 'mask' | 'focus' | 'depth' | 'luminance' | 'edges',
    opts: RenderOptions,
  ): { tex: GPUTexture; owned: boolean } | null {
    this.use(project);
    const layer =
      kind === 'depth'
        ? findDepthLayer(project, layerId)
        : kind === 'luminance' || kind === 'edges'
          ? findFirstLayer(project, layerId)
          : findLayer(project, layerId);
    if (!layer) return null;
    const geo = this.geometry(layer, opts);
    const slot = `${opts.variant}:${layer.id}:${kind}`;
    const keep = (key: string, compute: () => { tex: GPUTexture; owned: boolean }) => {
      const cached = opts.cache?.get(slot, key);
      if (cached) return { tex: cached, owned: false };
      const r = compute();
      if (!r.owned || !opts.cache) return r;
      opts.cache.set(slot, key, r.tex);
      return { tex: r.tex, owned: false };
    };
    const regionKey = `[${opts.region.x},${opts.region.y},${opts.region.width},${opts.region.height}]`;
    if (kind === 'luminance' || kind === 'edges') {
      const map = this.layerMap(frame, layer, geo, kind);
      return map
        ? keep(`${map.key}${geo.key}${regionKey}`, () => this.place(frame, geo, map.tex, opts, 'map-view'))
        : null;
    }
    if (kind === 'depth') {
      const d = this.depthTexture(frame, layer, geo);
      return d
        ? keep(`${d.key}${geo.key}${regionKey}`, () => this.place(frame, geo, d.tex, opts, 'depth-view'))
        : null;
    }
    if (kind === 'mask') {
      const m = this.processedMask(frame, layer, geo);
      if (!m) return { tex: this.core.white, owned: false };
      return keep(`${m.key}${geo.key}${regionKey}`, () => this.place(frame, geo, m.tex, opts, 'mask-view'));
    }
    const points = this.focusPoints(layer, geo);
    return keep(JSON.stringify(points.map((p) => [p.x, p.y, p.radius])) + regionKey, () => {
      const tex = this.core.pool.acquire(opts.region.width, opts.region.height, 'focus-view');
      this.core.focusMap(frame, points, tex, [opts.region.x, opts.region.y], opts.scale);
      return { tex, owned: true };
    });
  }

  private release(r: RenderResult): void {
    if (r.owned) this.core.pool.release(r.tex);
  }

  private node(frame: Frame, node: SceneNode, opts: RenderOptions): RenderResult | null {
    if (!node.visible) return null;
    if (node.kind === 'layer') return this.layer(frame, node, opts).result;
    return this.group(frame, node, opts);
  }

  /** Ausschnitt einer Leinwand-großen Textur (ganze Leinwand: die Textur selbst). */
  private region(
    frame: Frame,
    tex: GPUTexture,
    opts: RenderOptions,
    label: string,
  ): { tex: GPUTexture; owned: boolean } {
    const r = opts.region;
    if (isWhole(r, opts.canvasSize)) return { tex, owned: false };
    const out = this.core.pool.acquire(r.width, r.height, label);
    frame.encoder.copyTextureToTexture({ texture: tex, origin: [r.x, r.y] }, { texture: out }, [
      r.width,
      r.height,
    ]);
    return { tex: out, owned: true };
  }

  /** Aufbereitete Maske einer Ebene in Ebenengröße (Kantenübergang angewendet), gecacht. */
  private processedMask(frame: Frame, layer: Layer, geo: Geometry): { tex: GPUTexture; key: string } | null {
    const m = layer.mask;
    if (m.kind === 'full') return null;
    const [cw, ch] = geo.local;
    const px = geo.pxScale;
    const edgeKey = `${JSON.stringify(layer.maskEdge)}|${px}`;
    if (m.kind === 'stored') {
      const key = `mask|${m.id}@${cw}x${ch}|${m.inverted ? 'inv' : ''}|${edgeKey}`;
      const tex = this.sources.derive(key, cw, ch, (out) => {
        this.core.processMask(frame, this.sources.mask(m.id), m.inverted, layer.maskEdge, px, out);
      });
      return { tex, key };
    }
    // Tiefenband
    const key = `mask|${m.depthId}@${cw}x${ch}|band${m.near},${m.far},${m.overlap}|${edgeKey}`;
    const tex = this.sources.derive(key, cw, ch, (out) => {
      const band = this.core.pool.acquire(cw, ch, 'band');
      this.core.depthBand(frame, this.sources.mask(m.depthId), m.near, m.far, m.overlap * px, band);
      this.core.processMask(frame, band, false, layer.maskEdge, px, out);
      this.core.pool.release(band);
    });
    return { tex, key };
  }

  /**
   * Lochgefülltes Original, gecacht. Loch: bei gespeicherter Maske der ausgeblendete Bereich,
   * bei Tiefenbändern alles, was näher als fillBelow liegt (Inhalte vorderer Ebenen); leicht erweitert.
   */
  private filledSource(frame: Frame, layer: Layer, geo: Geometry): { tex: GPUTexture; key: string } | null {
    const m = layer.mask;
    if (m.kind === 'full') return null;
    if (m.kind === 'depth' && m.fillBelow <= 0) return null;
    const [cw, ch] = geo.local;
    const holeId = m.kind === 'stored' ? m.id : m.depthId;
    const holeKey = m.kind === 'stored' ? (m.inverted ? 'inv' : '') : `below${m.fillBelow}`;
    const key = `fill|${layer.originalId}+${holeId}@${cw}x${ch}|${holeKey}`;
    const tex = this.sources.derive(key, cw, ch, (out) => {
      const hole = this.core.pool.acquire(cw, ch, 'hole');
      const grown = this.core.pool.acquire(cw, ch, 'hole-grown');
      if (m.kind === 'stored') {
        // invertierte Ebenenmaske (Hintergrund) → das Loch ist die ursprüngliche Maske
        this.core.loadMask(frame, this.sources.mask(m.id), hole, !m.inverted);
      } else {
        this.core.depthBand(frame, this.sources.mask(m.depthId), 0, m.fillBelow, 0, hole);
      }
      this.core.dilateMask(frame, hole, grown, Math.max(2, 0.004 * Math.max(cw, ch)));
      this.core.holeFill(frame, this.sources.at(frame, layer.originalId, cw, ch), grown, out);
      this.core.pool.release(hole);
      this.core.pool.release(grown);
    });
    return { tex, key };
  }

  /** Tiefenkarte einer Ebene in Ebenengröße (für Effekte und die Ansicht „Tiefe“), gecacht. */
  private depthTexture(frame: Frame, layer: Layer, geo: Geometry): { tex: GPUTexture; key: string } | null {
    const id = layer.depthMap?.id ?? (layer.mask.kind === 'depth' ? layer.mask.depthId : null);
    if (!id || !this.sources.hasMask(id)) return null;
    const [cw, ch] = geo.local;
    const key = `depth|${id}@${cw}x${ch}`;
    const tex = this.sources.derive(key, cw, ch, (out) => {
      this.core.loadMask(frame, this.sources.mask(id), out);
    });
    return { tex, key };
  }

  private auxFor(
    frame: Frame,
    layer: Layer,
    geo: Geometry,
    maskTex: GPUTexture | null,
    depthTex: GPUTexture | null,
    opts: RenderOptions,
  ): AuxProvider {
    const points = this.focusPoints(layer, geo);
    const owned: GPUTexture[] = [];
    let aux: Aux | null = null;
    // Analysekarten der Ebene (aus dem Original, im Ebenenraum gecacht) bei Bedarf platzieren
    const addMaps = (a: Aux, need: readonly string[]) => {
      for (const id of ['luminance', 'edges'] as const) {
        if (!need.includes(id) || a[id]) continue;
        const map = this.layerMap(frame, layer, geo, id);
        if (!map) continue;
        const r = this.place(frame, geo, map.tex, opts, `map-${id}`);
        if (r.owned) owned.push(r.tex);
        a[id] = r.tex;
      }
    };
    return {
      key:
        (points.length ? `focus${JSON.stringify(points.map((p) => [p.x, p.y, p.radius]))}` : 'nofocus') +
        (depthTex ? `|depth${layer.depthMap?.id ?? ''}` : '') +
        geo.key,
      get: (need) => {
        if (aux) {
          addMaps(aux, need);
          return aux;
        }
        let mask = this.core.white;
        if (maskTex) {
          const r = this.place(frame, geo, maskTex, opts, 'mask-region');
          if (r.owned) owned.push(r.tex);
          mask = r.tex;
        }
        let focus = this.core.black;
        if (points.length) {
          focus = this.core.pool.acquire(opts.region.width, opts.region.height, 'focus');
          owned.push(focus);
          this.core.focusMap(frame, points, focus, [opts.region.x, opts.region.y], opts.scale);
        }
        let depth = this.core.black;
        if (depthTex) {
          const r = this.place(frame, geo, depthTex, opts, 'depth-region');
          if (r.owned) owned.push(r.tex);
          depth = r.tex;
        }
        aux = { mask, focus, depth, hasFocus: points.length > 0 };
        addMaps(aux, need);
        return aux;
      },
      release: () => {
        for (const t of owned) this.core.pool.release(t);
      },
    };
  }

  /** Rendert eine Ebene; liefert zusätzlich den Schatten (falls sichtbar). */
  private layer(
    frame: Frame,
    layer: Layer,
    opts: RenderOptions,
  ): { result: RenderResult; shadow: RenderResult | null } {
    const r = opts.region;
    const regionKey = `[${r.x},${r.y},${r.width},${r.height}]`;
    // Aufbereitung im Raum der Ebene, danach Platzierung auf der Leinwand (Transform)
    const geo = this.geometry(layer, opts);
    const [lw, lh] = geo.local;
    const filled = layer.holeFill ? this.filledSource(frame, layer, geo) : null;
    const base = filled?.tex ?? this.sources.at(frame, layer.originalId, lw, lh);
    const baseKey = (filled?.key ?? `${layer.originalId}@${lw}x${lh}`) + geo.key;
    // Gespeicherte Maske + Lochfüllung: Ebene wird deckend (Hintergrund). Tiefenband: gefüllt UND maskiert.
    const mask = filled && layer.mask.kind === 'stored' ? null : this.processedMask(frame, layer, geo);

    let src: RenderResult;
    const placedKey = baseKey + regionKey;
    const placedSlot = `${opts.variant}:${layer.id}:placed`;
    const placedCached = geo.aligned ? undefined : opts.cache?.get(placedSlot, placedKey);
    if (placedCached) src = { tex: placedCached, key: placedKey, owned: false };
    else {
      const placed = this.place(frame, geo, base, opts, 'region');
      if (!geo.aligned && opts.cache) {
        opts.cache.set(placedSlot, placedKey, placed.tex);
        src = { tex: placed.tex, key: placedKey, owned: false };
      } else src = { tex: placed.tex, key: placedKey, owned: placed.owned };
    }
    if (mask) {
      const key = `${src.key}*${mask.key}`;
      const slot = `${opts.variant}:${layer.id}:masked`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        this.release(src);
        src = { tex: cached, key, owned: false };
      } else {
        const maskRegion = this.place(frame, geo, mask.tex, opts, 'mask-region');
        const out = this.core.pool.acquire(r.width, r.height, 'masked');
        this.core.maskApply(frame, src.tex, maskRegion.tex, out);
        if (maskRegion.owned) this.core.pool.release(maskRegion.tex);
        this.release(src);
        if (opts.cache) {
          opts.cache.set(slot, key, out);
          src = { tex: out, key, owned: false };
        } else src = { tex: out, key, owned: true };
      }
    }

    const aux = this.auxFor(
      frame,
      layer,
      geo,
      mask?.tex ?? null,
      this.depthTexture(frame, layer, geo)?.tex ?? null,
      opts,
    );
    let shadow: RenderResult | null = null;
    const sh = layer.shadow;
    if (sh?.visible && !opts.ignoreEffects) {
      const gen: EffectInstance = {
        instanceId: `${sh.id}:gen`,
        effectId: 'shadow',
        effectVersion: sh.effectVersion,
        enabled: true,
        strength: 1,
        params: sh.params,
        region: 'whole',
      };
      // Schatten leitet sich aus der maskierten Ebene ab (vor ihren Effekten)
      const input: RenderResult = { ...src, owned: false };
      const generated = this.effects(frame, `${sh.id}:gen`, [gen], input, opts, aux, null);
      // Plugin fehlt oder ist fehlerhaft → kein Schatten
      shadow =
        generated === input
          ? null
          : this.effects(frame, sh.id, sh.effects, generated, opts, aux, { layer, geo });
    }
    const result = this.effects(frame, layer.id, layer.effects, src, opts, aux, { layer, geo });
    aux.release();
    return { result, shadow };
  }

  private group(frame: Frame, group: Group, opts: RenderOptions): RenderResult | null {
    const parts: { res: RenderResult; opacity: number; blend: BlendMode; offset: [number, number] }[] = [];
    const px = opts.parallax;
    const offsetOf = (n: SceneNode): [number, number] => {
      if (!px || n.kind !== 'layer' || n.depth === undefined) return [0, 0];
      const k = 0.5 - n.depth;
      return [px[0] * k, px[1] * k];
    };
    for (const child of group.children) {
      if (!child.visible) continue;
      if (child.kind === 'layer') {
        const { result, shadow } = this.layer(frame, child, opts);
        const offset = offsetOf(child);
        if (shadow && child.shadow)
          parts.push({ res: shadow, opacity: child.shadow.opacity, blend: child.shadow.blendMode, offset });
        parts.push({ res: result, opacity: child.opacity, blend: child.blendMode, offset });
      } else {
        const res = this.group(frame, child, opts);
        if (res) parts.push({ res, opacity: child.opacity, blend: child.blendMode, offset: [0, 0] });
      }
    }
    let comp: RenderResult;
    const first = parts[0];
    if (
      parts.length === 1 &&
      first &&
      first.opacity >= 1 &&
      first.blend === 'normal' &&
      first.offset[0] === 0 &&
      first.offset[1] === 0
    ) {
      comp = first.res;
    } else {
      const key = `group(${parts.map((p) => `${p.res.key}*${p.opacity}${p.blend}${p.offset.join(':')}`).join(',')})`;
      const slot = `${opts.variant}:${group.id}:comp`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        for (const p of parts) this.release(p.res);
        comp = { tex: cached, key, owned: false };
      } else {
        const { width, height } = opts.region;
        let base: GPUTexture | null = null;
        for (const p of parts) {
          const out = this.core.pool.acquire(width, height, 'composite');
          this.core.blend(frame, base, p.res.tex, out, p.opacity, p.blend, p.offset);
          if (base) this.core.pool.release(base);
          this.release(p.res);
          base = out;
        }
        if (!base) {
          base = this.core.pool.acquire(width, height, 'empty');
          this.core.fill(frame, base, [0, 0, 0, 0]);
        }
        if (opts.cache) {
          opts.cache.set(slot, key, base);
          comp = { tex: base, key, owned: false };
        } else comp = { tex: base, key, owned: true };
      }
    }
    // Gruppenmaske aus dem zusammengeführten Ergebnis (vor den Gruppeneffekten), dann Effekte, dann maskieren
    const gmask = this.effectMask(frame, group.mask, null, opts, { input: comp, group });
    const gmaskTex = gmask ? gmask.get() : null;
    const res = this.effects(frame, group.id, group.effects, comp, opts, null, null, group);
    if (!gmask || !gmaskTex) return res;
    const key = `${res.key}*gmask(${gmask.key})`;
    const slot = `${opts.variant}:${group.id}:gmask`;
    const cached = opts.cache?.get(slot, key);
    let out: RenderResult;
    if (cached) out = { tex: cached, key, owned: false };
    else {
      const t = this.core.pool.acquire(opts.region.width, opts.region.height, 'group-masked');
      this.core.maskApply(frame, res.tex, gmaskTex.tex, t);
      if (opts.cache) {
        opts.cache.set(slot, key, t);
        out = { tex: t, key, owned: false };
      } else out = { tex: t, key, owned: true };
    }
    this.release(res);
    if (gmaskTex.owned) this.core.pool.release(gmaskTex.tex);
    return out;
  }

  private effects(
    frame: Frame,
    hostId: string,
    effects: EffectInstance[],
    input: RenderResult,
    opts: RenderOptions,
    aux: AuxProvider | null,
    host: { layer: Layer; geo: Geometry } | null,
    group: Group | null = null,
  ): RenderResult {
    let cur = input;
    if (opts.ignoreEffects) return cur;
    const auxKey = aux?.key ?? 'noaux';
    effects.forEach((fx, i) => {
      if (!fx.enabled) return;
      const plugin = getPlugin(fx.effectId);
      const manifest = plugin?.manifest;
      if (plugin?.status !== 'ok' || !manifest) return;
      const impl = opts.final ? manifest.implementations.final : manifest.implementations.preview;
      if (impl === 'webgpu' && !this.runner.isCompiled(plugin)) return;
      const emask = this.effectMask(frame, fx.mask, host, opts, group ? { input: cur, group } : undefined);
      const mixKey = `|bm${fx.blendMode ?? 'normal'}|m${emask?.key ?? '-'}`;
      const key = `${cur.key}|${fx.effectId}#${plugin.revision}${JSON.stringify([fx.params, fx.strength, fx.region])}${auxKey}${mixKey}|${impl}`;
      const slot = `${opts.variant}:${hostId}:fx${i}`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        this.release(cur);
        cur = { tex: cached, key, owned: false };
        return;
      }
      if (impl !== 'webgpu') {
        // Ergebnis aus Worker/Dienst: Schlüssel ohne Mischung (Stärke/Maske/Mischmodus wirken danach hier)
        const asyncKey = `${cur.key}|${fx.effectId}#${manifest.version}${JSON.stringify(fx.params)}|${impl}`;
        const done = this.async.result(asyncKey);
        if (!done) {
          const p = { ...defaultParams(manifest), ...fx.params };
          this.async.request(
            frame,
            asyncKey,
            {
              label: `${manifest.name}${opts.final ? ' (Vollauflösung)' : ''}`,
              impl,
              final: opts.final ?? false,
              effectId: fx.effectId,
              params: p,
              seed: typeof p.seed === 'number' ? p.seed : 0,
              scale: opts.scale,
              origin: [opts.region.x, opts.region.y],
              canvasSize: opts.canvasSize,
            },
            cur.tex,
          );
          this.missingAsync.push(asyncKey);
          return; // Eingang vorerst durchreichen
        }
        this.effectRuns++;
        const m = emask?.get() ?? null;
        const weight = Math.max(0, Math.min(1, fx.strength));
        const mode = fx.blendMode ?? 'normal';
        let out: GPUTexture;
        if (weight >= 1 && fx.region === 'whole' && mode === 'normal' && !m) {
          out = this.core.pool.acquire(done.width, done.height, 'async-result');
          frame.encoder.copyTextureToTexture({ texture: done }, { texture: out }, [done.width, done.height]);
        } else {
          out = this.core.pool.acquire(done.width, done.height, 'async-mix');
          const focus = fx.region === 'whole' ? this.core.black : (aux?.get([]).focus ?? this.core.black);
          const region = { whole: 0, 'focus-weighted': 1, 'inverse-focus': 2 }[fx.region];
          this.core.mix(frame, cur.tex, done, focus, out, weight, region, mode, m?.tex ?? null);
        }
        if (m?.owned) this.core.pool.release(m.tex);
        this.release(cur);
        if (opts.cache) {
          opts.cache.set(slot, key, out);
          cur = { tex: out, key, owned: false };
        } else cur = { tex: out, key, owned: true };
        return;
      }
      this.effectRuns++;
      const need = plugin.manifest?.requires ?? [];
      const temps: GPUTexture[] = [];
      const a = aux?.get(need) ?? {
        mask: this.core.white,
        focus: this.core.black,
        depth: this.core.black,
        hasFocus: false,
        ...this.inputMaps(frame, cur.tex, opts, need, temps),
      };
      const m = emask?.get() ?? null;
      // Zweitbild (Parameter vom Typ "image"): Original in passender Auflösung; fehlt es, meldet der Shader „kein Bild“
      const imgSpec = manifest.params.find((ps) => ps.type === 'image');
      const imgId = imgSpec ? fx.params[imgSpec.key] : undefined;
      const image = typeof imgId === 'string' && imgId ? this.imageTexture(frame, imgId, opts) : null;
      const fxRun = imgSpec && imgId && !image ? { ...fx, params: { ...fx.params, [imgSpec.key]: '' } } : fx;
      const out = this.runner.apply(
        frame,
        plugin,
        fxRun,
        cur.tex,
        a,
        {
          scale: opts.scale,
          origin: [opts.region.x, opts.region.y],
          canvasSize: opts.canvasSize,
          hasFocus: a.hasFocus,
        },
        m?.tex ?? null,
        image,
      );
      if (m?.owned) this.core.pool.release(m.tex);
      for (const t of temps) this.core.pool.release(t);
      this.release(cur);
      if (opts.cache) {
        opts.cache.set(slot, key, out);
        cur = { tex: out, key, owned: false };
      } else cur = { tex: out, key, owned: true };
    });
    return cur;
  }
}

/** Summe der Effekt-Reichweiten (px, volle Auflösung) entlang des tiefsten Pfads – Überlappung der Export-Kacheln. */
export function projectReach(node: SceneNode, reachOf: (fx: EffectInstance) => number): number {
  // Kantenmasken aus dem Eingang (Gruppen) lesen wie die Kantenkarte bis zu 8 px Umgebung
  const edgeMask = (m: EffectMask | undefined) =>
    m?.kind === 'map' && m.map === 'edges' ? EDGE_MASK_REACH : 0;
  const sum = (list: EffectInstance[]) =>
    list.filter((e) => e.enabled).reduce((s, e) => s + reachOf(e) + edgeMask(e.mask), 0);
  const own = sum(node.effects) + (node.kind === 'group' ? edgeMask(node.mask) : 0);
  if (node.kind === 'layer') {
    const sh = node.shadow;
    const shadowReach = sh?.visible
      ? reachOf({
          instanceId: '',
          effectId: 'shadow',
          effectVersion: sh.effectVersion,
          enabled: true,
          strength: 1,
          params: sh.params,
          region: 'whole',
        }) + sum(sh.effects)
      : 0;
    return Math.max(own, shadowReach);
  }
  return own + Math.max(0, ...node.children.filter((c) => c.visible).map((c) => projectReach(c, reachOf)));
}
