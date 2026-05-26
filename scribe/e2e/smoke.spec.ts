import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// M3 smoke test (PRODUCT_SPEC.md §9 / CLAUDE.md §9): create a note, type, and
// confirm it survives a full restart. Runs against the built app with an isolated
// userData dir so it never touches the real local database.
const userDataDir = mkdtempSync(join(tmpdir(), 'scribe-e2e-'));

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, SCRIBE_USER_DATA: userDataDir },
  });
}

// Dismiss the first-run privacy notice if it is shown (only on the first launch
// for a fresh userData dir).
async function dismissPrivacyNotice(window: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await window
    .getByRole('button', { name: 'I understand' })
    .click({ timeout: 5000 })
    .catch(() => {
      /* already accepted */
    });
}

test('notes persist across an app restart', async () => {
  const note = 'M3 persistence check';

  let app = await launch();
  let window = await app.firstWindow();
  await dismissPrivacyNotice(window);

  await window.getByRole('button', { name: 'New Note' }).click();
  const editor = window.getByTestId('notes-editor');
  await editor.click();
  await window.keyboard.type(note);
  // Let the autosave debounce (700ms) flush.
  await window.waitForTimeout(1200);
  await app.close();

  app = await launch();
  window = await app.firstWindow();
  await dismissPrivacyNotice(window);
  await window.locator('[data-meeting-item]').first().click();
  await expect(window.getByTestId('notes-editor')).toContainText(note);
  await app.close();
});
