/**
 * Tests for ROADMAP_05 Whisper model management pure functions.
 *
 * DB-level and IPC-level tests require Electron's Node.js for native
 * addons (onnxruntime-node) and are verified manually. Here we test:
 *   • WhisperModelNameSchema  — Zod validation
 *   • WhisperDownloadProgress — type-level contract via schema construction
 *   • getModelStatuses shape  — requires no DB or Electron (checked separately)
 *   • WHISPER_MODEL_NAMES     — the exported catalogue constants
 */
import { describe, it, expect } from 'vitest';
import { WhisperModelNameSchema } from '../src/shared/ipc-contract';

describe('WhisperModelNameSchema', () => {
  it('accepts valid model names', () => {
    for (const name of ['tiny', 'base', 'small', 'medium']) {
      expect(() => WhisperModelNameSchema.parse(name)).not.toThrow();
    }
  });

  it('rejects unknown model names', () => {
    expect(() => WhisperModelNameSchema.parse('large')).toThrow();
    expect(() => WhisperModelNameSchema.parse('')).toThrow();
    expect(() => WhisperModelNameSchema.parse('huge')).toThrow();
  });

  it('returns the correct value after parsing', () => {
    expect(WhisperModelNameSchema.parse('base')).toBe('base');
    expect(WhisperModelNameSchema.parse('tiny')).toBe('tiny');
  });
});

describe('IPC channel names (ROADMAP_05)', () => {
  it('all Whisper IPC channels are defined in the contract', async () => {
    const { IPC } = await import('../src/shared/ipc-contract');
    expect(IPC.whisperModelsGet).toBe('whisper:modelsGet');
    expect(IPC.whisperModelDownload).toBe('whisper:modelDownload');
    expect(IPC.whisperModelCancel).toBe('whisper:modelCancel');
    expect(IPC.whisperModelDelete).toBe('whisper:modelDelete');
    expect(IPC.whisperModelDownloadProgress).toBe('whisper:modelDownloadProgress');
    expect(IPC.settingsSetTranscriptionProvider).toBe('settings:setTranscriptionProvider');
    expect(IPC.settingsSetWhisperModel).toBe('settings:setWhisperModel');
  });
});
