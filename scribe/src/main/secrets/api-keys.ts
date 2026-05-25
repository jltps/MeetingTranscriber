import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// API key access lives behind these accessors so the source can change without
// touching callers. M2 reads from the environment (or a gitignored .env); M5
// replaces this with Electron safeStorage + the Settings screen. Keys are never
// returned to the renderer and never logged (CLAUDE.md §1.2).

let envLoaded = false;

function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* no .env file — fall back to the shell environment */
  }
}

export function getDeepgramKey(): string | null {
  ensureEnvLoaded();
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  return key ? key : null;
}
