import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Main is externalized (it requires native better-sqlite3 + zod at runtime).
// Preload is NOT externalized so its deps are inlined — required because the
// renderer runs with sandbox:true and a sandboxed preload cannot require npm
// modules from node_modules; everything it needs must be bundled in.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [],
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    build: {
      rollupOptions: {
        input: 'src/renderer/index.html',
      },
    },
  },
});
