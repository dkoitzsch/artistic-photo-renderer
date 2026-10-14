// Lädt die Browser-Modelle aus models/registry.json einmalig nach tests/.cache/models (SHA-256-geprüft).
// Die E2E-Tests liefern sie über den Dev-Server (/__models/) aus, damit Tests ohne Netz laufen.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const dir = `${root}tests/.cache/models`;
mkdirSync(dir, { recursive: true });
const registry = JSON.parse(readFileSync(`${root}models/registry.json`, 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

for (const m of registry.models.filter((x) => x.runtime === 'browser')) {
  for (const f of m.files ?? []) {
    const path = `${dir}/${f.name}`;
    if (existsSync(path) && sha(readFileSync(path)) === f.sha256) {
      console.log(`ok      ${f.name}`);
      continue;
    }
    process.stdout.write(`lade    ${f.name} (${(f.size / 1e6).toFixed(0)} MB) … `);
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`${f.name}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== f.sha256) throw new Error(`${f.name}: Prüfsumme stimmt nicht`);
    writeFileSync(path, buf);
    console.log('fertig');
  }
}
