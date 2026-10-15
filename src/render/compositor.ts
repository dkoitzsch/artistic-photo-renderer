// Rendert den Projektbaum (hinten → vorn) in eine Textur. Für die Vorschau werden Zwischenergebnisse
// pro Layer und Effektschritt gecacht (Schlüssel aus Eingang + Parametern); nur Geändertes wird neu berechnet.

import { getPlugin } from '../effects/pluginStore';
import {
  findNode,
  walk,
  type BlendMode,
  type EffectInstance,
  type Group,
  type Layer,
  type OriginalRef,
  type Project,
  type SceneNode,
} from '../state/project';
import { apply, invert, isAligned, placement, type Affine } from '../state/transform';
import type { GpuCore } from './core';
import type { EffectRunner } from './effectRunner';
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

const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

type Aux = { mask: GPUTexture; focus: GPUTexture; depth: GPUTexture; hasFocus: boolean };

/** Lazy Zusatz-Eingänge einer Ebene: werden erst erzeugt, wenn ein Effekt wirklich rechnen muss. */
type AuxProvider = { key: string; get: () => Aux; release: () => void };

export class Compositor {
  /** Anzahl der in diesem Frame tatsächlich ausgeführten Effekte (für Tests/Statistik) */
  effectRuns = 0;

  /** Leinwand und Originale des gerade gerenderten Projekts (für die Lage der Ebenen) */
  private canvas: { width: number; height: number } = { width: 1, height: 1 };
  private originals: Record<string, OriginalRef> = {};

  constructor(
    private readonly core: GpuCore,
    private readonly sources: SourceStore,
    private readonly runner: EffectRunner,
  ) {}

  private use(project: Project): void {
    this.canvas = project.canvas;
    this.originals = project.originals;
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
    kind: 'mask' | 'focus' | 'depth',
    opts: RenderOptions,
  ): { tex: GPUTexture; owned: boolean } | null {
    this.use(project);
    const layer = kind === 'depth' ? findDepthLayer(project, layerId) : findLayer(project, layerId);
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
    return {
      key:
        (points.length ? `focus${JSON.stringify(points.map((p) => [p.x, p.y, p.radius]))}` : 'nofocus') +
        (depthTex ? `|depth${layer.depthMap?.id ?? ''}` : '') +
        geo.key,
      get: () => {
        if (aux) return aux;
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
      const generated = this.effects(frame, `${sh.id}:gen`, [gen], input, opts, aux);
      // Plugin fehlt oder ist fehlerhaft → kein Schatten
      shadow = generated === input ? null : this.effects(frame, sh.id, sh.effects, generated, opts, aux);
    }
    const result = this.effects(frame, layer.id, layer.effects, src, opts, aux);
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
    return this.effects(frame, group.id, group.effects, comp, opts, null);
  }

  private effects(
    frame: Frame,
    hostId: string,
    effects: EffectInstance[],
    input: RenderResult,
    opts: RenderOptions,
    aux: AuxProvider | null,
  ): RenderResult {
    let cur = input;
    if (opts.ignoreEffects) return cur;
    const auxKey = aux?.key ?? 'noaux';
    effects.forEach((fx, i) => {
      if (!fx.enabled) return;
      const plugin = getPlugin(fx.effectId);
      if (plugin?.status !== 'ok' || !this.runner.isCompiled(plugin)) return;
      const key = `${cur.key}|${fx.effectId}#${plugin.revision}${JSON.stringify([fx.params, fx.strength, fx.region])}${auxKey}`;
      const slot = `${opts.variant}:${hostId}:fx${i}`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        this.release(cur);
        cur = { tex: cached, key, owned: false };
        return;
      }
      this.effectRuns++;
      const a = aux?.get() ?? {
        mask: this.core.white,
        focus: this.core.black,
        depth: this.core.black,
        hasFocus: false,
      };
      const out = this.runner.apply(frame, plugin, fx, cur.tex, a, {
        scale: opts.scale,
        origin: [opts.region.x, opts.region.y],
        canvasSize: opts.canvasSize,
        hasFocus: a.hasFocus,
      });
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
  const sum = (list: EffectInstance[]) => list.filter((e) => e.enabled).reduce((s, e) => s + reachOf(e), 0);
  const own = sum(node.effects);
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
