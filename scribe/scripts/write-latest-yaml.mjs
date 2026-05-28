// Writes release/latest.yaml — the auto-update manifest electron-updater consumes.
// Run after electron-builder finishes (`pnpm dist`). Picks the newest
// `Nexus Setup *.exe` in release/, hashes it, and emits the manifest.
// We keep it as `.yaml` per repo convention; electron-updater accepts both
// `.yml` and `.yaml` when pointed at the file explicitly via the update feed.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'release');
const installers = readdirSync(releaseDir)
  .filter((n) => /^Nexus Setup .+\.exe$/.test(n))
  .map((n) => ({ name: n, mtime: statSync(join(releaseDir, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (installers.length === 0) {
  console.error('[latest.yaml] no Nexus Setup *.exe found in release/');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(releaseDir, '..', 'package.json'), 'utf8'));
const exeName = installers[0].name;
const exePath = join(releaseDir, exeName);
const exeBytes = readFileSync(exePath);
const sha512 = createHash('sha512').update(exeBytes).digest('base64');
const size = exeBytes.length;
const releaseDate = new Date(statSync(exePath).mtime).toISOString();

const yaml =
  `version: ${pkg.version}\n` +
  `files:\n` +
  `  - url: ${exeName}\n` +
  `    sha512: ${sha512}\n` +
  `    size: ${size}\n` +
  `path: ${exeName}\n` +
  `sha512: ${sha512}\n` +
  `releaseDate: '${releaseDate}'\n`;

writeFileSync(join(releaseDir, 'latest.yaml'), yaml);
console.log(`[latest.yaml] wrote manifest for ${exeName} (v${pkg.version})`);
