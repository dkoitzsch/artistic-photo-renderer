// Startet Web-App (Vite) und lokalen ML-Dienst gemeinsam. Fehlt uv, läuft nur die Web-App
// (die App nutzt dann die Browser-Modelle). Strg+C beendet beide.

import { spawn, spawnSync } from 'node:child_process';

const procs = [];
const prefix = (name, color) => (chunk) => {
  for (const line of chunk.toString().split('\n'))
    if (line.trim()) console.log(`\x1b[${color}m[${name}]\x1b[0m ${line}`);
};

function start(name, color, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  p.stdout.on('data', prefix(name, color));
  p.stderr.on('data', prefix(name, color));
  p.on('exit', (code) => {
    console.log(`[${name}] beendet (${code ?? 'Signal'})`);
    if (name === 'web') shutdown();
  });
  procs.push(p);
  return p;
}

function shutdown() {
  for (const p of procs) if (!p.killed) p.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start('web', '36', 'npx', ['vite']);

const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0;
if (hasUv && process.env.BLS_NO_SERVICE !== '1') {
  start('ml', '35', 'uv', ['run', '--project', 'ml-service', 'ml-service']);
} else {
  console.log('[ml] uv nicht gefunden (oder BLS_NO_SERVICE=1) – nur Web-App; ML läuft im Browser.');
}
