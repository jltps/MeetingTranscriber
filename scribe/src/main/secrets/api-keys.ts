import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteSetting, getSetting, setSetting } from '../db/settings';
import { decryptSecret, encryptSecret } from './safe-store';

// API key access lives behind these accessors so the source can change without
// touching callers (CLAUDE.md §1.2). Keys set via the Settings screen are stored
// encrypted (safeStorage). For dev convenience, a gitignored .env / shell env var
// is used as a fallback when no key has been saved. Keys are never returned to
// the renderer and never logged.

const DEEPGRAM_SETTING = 'deepgram_key_enc';
const ANTHROPIC_SETTING = 'anthropic_key_enc';
const OPENAI_COMPAT_SETTING = 'openai_compat_key_enc';
const GLADIA_SETTING = 'gladia_key_enc';

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

function readKey(settingKey: string, envVar: string): string | null {
  const stored = getSetting(settingKey);
  if (stored) {
    const decrypted = decryptSecret(stored);
    if (decrypted) return decrypted;
  }
  ensureEnvLoaded();
  const fromEnv = process.env[envVar]?.trim();
  return fromEnv ? fromEnv : null;
}

function storeKey(settingKey: string, key: string | null): void {
  if (key && key.trim()) setSetting(settingKey, encryptSecret(key.trim()));
  else deleteSetting(settingKey);
}

export function getDeepgramKey(): string | null {
  return readKey(DEEPGRAM_SETTING, 'DEEPGRAM_API_KEY');
}

export function getAnthropicKey(): string | null {
  return readKey(ANTHROPIC_SETTING, 'ANTHROPIC_API_KEY');
}

export function setDeepgramKey(key: string | null): void {
  storeKey(DEEPGRAM_SETTING, key);
}

export function setAnthropicKey(key: string | null): void {
  storeKey(ANTHROPIC_SETTING, key);
}

export function getOpenAiKey(): string | null {
  return readKey(OPENAI_COMPAT_SETTING, 'OPENAI_API_KEY');
}

export function setOpenAiKey(key: string | null): void {
  storeKey(OPENAI_COMPAT_SETTING, key);
}

export function getGladiaKey(): string | null {
  return readKey(GLADIA_SETTING, 'GLADIA_API_KEY');
}

export function setGladiaKey(key: string | null): void {
  storeKey(GLADIA_SETTING, key);
}
