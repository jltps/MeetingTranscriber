import { defineConfig } from '@playwright/test';

// Drives the built Electron app (out/). Run `pnpm build` first, then
// `pnpm test:e2e`. Kept lightweight per CLAUDE.md §9.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
});
