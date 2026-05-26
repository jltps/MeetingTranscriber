import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Launches the packaged Windows build (M6) to confirm it actually runs: main
// process boots, migrations apply, the preload bridge works, and the renderer
// loads from file://. Skips unless `pnpm dist:dir` has produced the build.
const exePath = join(process.cwd(), 'release', 'win-unpacked', 'Scribe.exe');

test('packaged app launches and renders', async () => {
  test.skip(!existsSync(exePath), 'No packaged build — run `pnpm dist:dir` first.');

  const userDataDir = mkdtempSync(join(tmpdir(), 'scribe-pkg-'));
  const app = await electron.launch({
    executablePath: exePath,
    args: [],
    env: { ...process.env, SCRIBE_USER_DATA: userDataDir },
  });
  const window = await app.firstWindow();
  // Fresh userData → first-run privacy notice proves the full stack came up.
  await expect(window.getByRole('button', { name: 'I understand' })).toBeVisible({
    timeout: 20_000,
  });
  await app.close();
});
