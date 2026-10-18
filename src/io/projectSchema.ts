// Prüft geladene Projektdaten (Projektdatei, Autosave), bevor sie in den Store kommen,
// und hebt ältere Formatversionen an.

import { normalizeMalplan } from '../malplan/model';
import { DEFAULT_MASK_EDGE, PROJECT_FORMAT_VERSION, type Project } from '../state/project';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fail(msg: string): never {
  throw new Error(`Projektdaten ungültig: ${msg}`);
}

function checkEffects(v: unknown, where: string): void {
  if (!Array.isArray(v)) fail(`${where}.effects fehlt`);
  v.forEach((e: unknown, i) => {
    if (!isObj(e) || !isStr(e.instanceId) || !isStr(e.effectId) || !isObj(e.params) || !isNum(e.strength))
      fail(`${where}.effects[${i}] unvollständig`);
    const at = `${where}.effects[${i}]`;
    if (e.blendMode !== undefined && !BLEND_MODES.includes(e.blendMode as never))
      fail(`${at}.blendMode unbekannt`);
    if (e.mask !== undefined) checkNodeMask(e.mask, `${at}.mask`);
  });
}

/** Maske eines Effekts oder einer Gruppe (EffectMask). */
function checkNodeMask(m: unknown, at: string): void {
  if (!isObj(m)) fail(`${at} ungültig`);
  if (m.kind === 'map') {
    if (
      !['luminance', 'edges', 'depth'].includes(m.map as string) ||
      !isNum(m.from) ||
      !isNum(m.to) ||
      !isNum(m.feather) ||
      typeof m.invert !== 'boolean'
    )
      fail(`${at} (Kartenbereich) unvollständig`);
  } else if (m.kind === 'layer') {
    if (!isStr(m.layerId) || typeof m.invert !== 'boolean') fail(`${at} (Ebene) unvollständig`);
  } else fail(`${at}.kind unbekannt`);
}

const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'lighten',
  'darken',
  'difference',
];

function checkProvenance(v: unknown, where: string): void {
  if (!isObj(v) || !isStr(v.modelId) || typeof v.commercialUse !== 'boolean')
    fail(`${where}.provenance unvollständig`);
}

function checkLayer(n: Record<string, unknown>, where: string, originals: Record<string, unknown>): void {
  if (!isStr(n.originalId) || !(n.originalId in originals))
    fail(`${where} verweist auf ein fehlendes Original`);
  const mask = n.mask;
  if (!isObj(mask) || !isObj(n.transform)) fail(`${where}.mask/transform fehlt`);
  const t = n.transform;
  if (!isNum(t.x) || !isNum(t.y) || !isNum(t.scale) || !isNum(t.rotation) || !(t.scale > 0))
    fail(`${where}.transform unvollständig`);
  for (const k of ['flipX', 'flipY'] as const)
    if (t[k] !== undefined && typeof t[k] !== 'boolean')
      fail(`${where}.transform.${k} ist kein Wahrheitswert`);
  if (mask.kind === 'stored') {
    if (!isStr(mask.id) || !isNum(mask.width) || !isNum(mask.height)) fail(`${where}.mask unvollständig`);
    checkProvenance(mask.provenance, `${where}.mask`);
  } else if (mask.kind === 'depth') {
    if (
      !isStr(mask.depthId) ||
      !isNum(mask.near) ||
      !isNum(mask.far) ||
      !isNum(mask.overlap) ||
      !isNum(mask.fillBelow)
    )
      fail(`${where}.mask (Tiefenband) unvollständig`);
  } else if (mask.kind !== 'full') fail(`${where}.mask.kind unbekannt`);
  if (n.depthMap !== undefined) {
    const d = n.depthMap;
    if (!isObj(d) || !isStr(d.id) || !isNum(d.width) || !isNum(d.height))
      fail(`${where}.depthMap unvollständig`);
    checkProvenance(d.provenance, `${where}.depthMap`);
  }
  const edge = n.maskEdge;
  if (!isObj(edge) || !isNum(edge.hardness) || !isNum(edge.offset) || !isStr(edge.curve))
    fail(`${where}.maskEdge unvollständig`);
  if (n.focusMap !== undefined) {
    const fm = n.focusMap;
    if (!isObj(fm) || !Array.isArray(fm.points)) fail(`${where}.focusMap unvollständig`);
    fm.points.forEach((p: unknown, i) => {
      if (!isObj(p) || !isStr(p.id) || !isNum(p.x) || !isNum(p.y) || !isNum(p.radius))
        fail(`${where}.focusMap.points[${i}] unvollständig`);
    });
  }
  if (n.shadow !== undefined) {
    const sh = n.shadow;
    if (!isObj(sh) || !isStr(sh.id) || !isObj(sh.params) || !isNum(sh.opacity))
      fail(`${where}.shadow unvollständig`);
    checkEffects(sh.effects, `${where}.shadow`);
  }
}

function checkNode(n: unknown, where: string, originals: Record<string, unknown>): void {
  if (!isObj(n) || !isStr(n.id) || !isStr(n.name)) fail(`${where} unvollständig`);
  checkEffects(n.effects, where);
  if (!isNum(n.opacity)) fail(`${where}.opacity fehlt`);
  if (n.kind === 'layer') {
    checkLayer(n, where, originals);
  } else if (n.kind === 'group') {
    if (!Array.isArray(n.children)) fail(`${where}.children fehlt`);
    if (n.mask !== undefined) checkNodeMask(n.mask, `${where}.mask`);
    n.children.forEach((c: unknown, i) => {
      checkNode(c, `${where}.children[${i}]`, originals);
    });
  } else fail(`${where}.kind unbekannt`);
}

/** Format 1 → 2: Lizenzmodus, Kantenübergang und Lochfüllung ergänzen; 2 → 3: nur neue, optionale Felder. */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const json = raw.formatVersion === 1 ? migrate1to2(raw) : raw;
  // 2 → 3: Tiefenkarten (optional), 3 → 4: Transformation wird angewendet (bisher stets neutral) – keine Änderung nötig
  // 4 → 5: Effekte erhalten optional blendMode und mask (fehlen = bisheriges Verhalten)
  let v = json.formatVersion === 2 ? { ...json, formatVersion: 3 } : json;
  if (v.formatVersion === 3) v = { ...v, formatVersion: 4 };
  if (v.formatVersion === 4) v = { ...v, formatVersion: 5 };
  // 5 → 6: Gruppen erhalten optional eine eigene Maske
  if (v.formatVersion === 5) v = { ...v, formatVersion: 6 };
  // 6 → 7: optionale Malplan-Einstellungen
  if (v.formatVersion === 6) v = { ...v, formatVersion: 7 };
  return v;
}

function migrate1to2(json: Record<string, unknown>): Record<string, unknown> {
  const fixNode = (n: unknown): unknown => {
    if (!isObj(n)) return n;
    if (n.kind === 'layer') return { maskEdge: { ...DEFAULT_MASK_EDGE }, holeFill: false, ...n };
    if (n.kind === 'group' && Array.isArray(n.children)) return { ...n, children: n.children.map(fixNode) };
    return n;
  };
  return { ...json, formatVersion: 2, licenseMode: 'commercial', root: fixNode(json.root) };
}

export function parseProject(raw: unknown): Project {
  if (!isObj(raw)) fail('kein Objekt');
  if (!isNum(raw.formatVersion)) fail('formatVersion fehlt');
  if (raw.formatVersion > PROJECT_FORMAT_VERSION)
    fail(`Formatversion ${raw.formatVersion} ist neuer als diese App (${PROJECT_FORMAT_VERSION}).`);
  const json = migrate(raw);
  if (!isStr(json.id) || !isStr(json.name)) fail('id/name fehlt');
  const canvas = json.canvas;
  if (!isObj(canvas) || !isNum(canvas.width) || !isNum(canvas.height)) fail('canvas fehlt');
  if (json.licenseMode !== 'commercial' && json.licenseMode !== 'all') fail('licenseMode fehlt');
  if (!isObj(json.originals)) fail('originals fehlt');
  for (const [id, o] of Object.entries(json.originals))
    if (!isObj(o) || o.id !== id || !isStr(o.mimeType) || !isNum(o.width) || !isNum(o.height))
      fail(`original ${id.slice(0, 8)} unvollständig`);
  if (!isObj(json.root) || json.root.kind !== 'group') fail('root muss eine Gruppe sein');
  checkNode(json.root, 'root', json.originals);
  // Malplan: unvollständige oder fremde Werte auf gültige Einstellungen bringen
  if (json.malplan !== undefined) {
    if (!isObj(json.malplan)) fail('malplan muss ein Objekt sein');
    json.malplan = normalizeMalplan(json.malplan, { width: canvas.width, height: canvas.height });
  }
  return json as unknown as Project;
}
