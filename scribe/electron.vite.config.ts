import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Main is externalized (it requires native better-sqlite3 + zod at runtime).
// Preload is NOT externalized so its deps are inlined — required because the
// renderer runs with sandbox:true and a sandboxed preload cannot require npm
// modules from node_modules; everything it needs must be bundled in.

// V0.7.1: bake the Google Calendar client_secret into the packaged main bundle
// when it's available at build time (CI passes it from a GitHub Actions secret).
// The repo stays clean of the GOCSPX- prefix that GitHub's secret scanner would
// otherwise flag, and `scribe/.env` keeps working unchanged for local dev (when
// the env var is unset, vite leaves the source alone and the runtime resolver
// in calendar/config.ts falls through to its .env loader).
const googleSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: googleSecret
      ? { 'process.env.GOOGLE_OAUTH_CLIENT_SECRET': JSON.stringify(googleSecret) }
      : {},
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
