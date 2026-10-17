/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Laufzeitdateien der ML-Bibliotheken, lokal ausgeliefert unter /vendor/… (keine CDN-Anfragen). */
const VENDOR_FILES: Record<string, string> = {
  'vendor/ort/ort-wasm-simd-threaded.asyncify.mjs':
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm':
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
  'vendor/mediapipe/vision_wasm_module_internal.js':
    'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js',
  'vendor/mediapipe/vision_wasm_module_internal.wasm':
    'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm',
};

function vendorAssets(): Plugin {
  const abs = (rel: string) => fileURLToPath(new URL(`./${rel}`, import.meta.url));
  const type = (f: string) => (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  return {
    name: 'vendor-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const src = VENDOR_FILES[path];
        if (!src) {
          next();
          return;
        }
        res.setHeader('Content-Type', type(path));
        createReadStream(abs(src)).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(VENDOR_FILES))
        this.emitFile({ type: 'asset', fileName, source: readFileSync(abs(src)) });
    },
  };
}

/**
 * Nur Dev-Server: liefert den lokalen Modell-Cache (tests/.cache/models) unter /__models/ aus,
 * damit Tests Modelle ohne Netz laden (App nutzt das nur mit localStorage 'bls.modelMirror').
 */
function testModelMirror(): Plugin {
  const dir = fileURLToPath(new URL('./tests/.cache/models', import.meta.url));
  return {
    name: 'test-model-mirror',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__models/', (req, res, next) => {
        const file = join(dir, basename(decodeURIComponent((req.url ?? '').split('?')[0] ?? '')));
        if (!existsSync(file)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vendorAssets(), testModelMirror()],
  worker: { format: 'es' },
  // Abhängigkeiten, die erst in Workern/Plugins importiert werden, vorab bündeln (sonst lädt der Dev-Server beim
  // ersten Gebrauch die Seite neu)
  optimizeDeps: { include: ['delaunator'] },
  server: { port: 5317, strictPort: true },
  preview: { port: 4317, strictPort: true },
  build: { target: 'es2023' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
