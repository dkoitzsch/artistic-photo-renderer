// Prüft geladene Projektdaten (Projektdatei, Autosave), bevor sie in den Store kommen.

import { PROJECT_FORMAT_VERSION, type Project } from '../state/project';

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
  });
}

function checkNode(n: unknown, where: string, originals: Record<string, unknown>): void {
  if (!isObj(n) || !isStr(n.id) || !isStr(n.name)) fail(`${where} unvollständig`);
  checkEffects(n.effects, where);
  if (!isNum(n.opacity)) fail(`${where}.opacity fehlt`);
  if (n.kind === 'layer') {
    if (!isStr(n.originalId) || !(n.originalId in originals))
      fail(`${where} verweist auf ein fehlendes Original`);
    if (!isObj(n.mask) || !isObj(n.transform)) fail(`${where}.mask/transform fehlt`);
  } else if (n.kind === 'group') {
    if (!Array.isArray(n.children)) fail(`${where}.children fehlt`);
    n.children.forEach((c: unknown, i) => {
      checkNode(c, `${where}.children[${i}]`, originals);
    });
  } else fail(`${where}.kind unbekannt`);
}

export function parseProject(json: unknown): Project {
  if (!isObj(json)) fail('kein Objekt');
  if (!isNum(json.formatVersion)) fail('formatVersion fehlt');
  if (json.formatVersion > PROJECT_FORMAT_VERSION)
    fail(`Formatversion ${json.formatVersion} ist neuer als diese App (${PROJECT_FORMAT_VERSION}).`);
  if (!isStr(json.id) || !isStr(json.name)) fail('id/name fehlt');
  const canvas = json.canvas;
  if (!isObj(canvas) || !isNum(canvas.width) || !isNum(canvas.height)) fail('canvas fehlt');
  if (!isObj(json.originals)) fail('originals fehlt');
  for (const [id, o] of Object.entries(json.originals))
    if (!isObj(o) || o.id !== id || !isStr(o.mimeType) || !isNum(o.width) || !isNum(o.height))
      fail(`original ${id.slice(0, 8)} unvollständig`);
  if (!isObj(json.root) || json.root.kind !== 'group') fail('root muss eine Gruppe sein');
  checkNode(json.root, 'root', json.originals);
  return json as unknown as Project;
}
