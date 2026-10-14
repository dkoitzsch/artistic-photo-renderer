/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5317, strictPort: true },
  preview: { port: 4317, strictPort: true },
  build: { target: 'es2023' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
