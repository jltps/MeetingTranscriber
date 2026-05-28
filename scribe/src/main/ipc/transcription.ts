import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { IPC, TranscriptionStartSchema } from '../../shared/ipc-contract';
import type { TranscriptSegment } from '../../shared/types';
import { createTranscriptionSession } from '../transcription';
import type { TranscriptionSession } from '../transcription/session';
import {
  attributeMe,
  attributeWords,
  groupAttributedWords,
  type EnergySample,
} from '../transcription/me-attribution';
import { insertTranscriptSegment, saveDeepgramUsage } from '../db/meetings';
import { logger } from '../logger';

// One active session at a time. Control messages (start/stop) are Zod-validated;
// the high-frequency pushFrame channel carries a raw ArrayBuffer and is NOT
// validated per-frame (CLAUDE.md §4). Finalized segments are persisted to the
// active meeting; audio frames go straight to the socket, never to disk (§1.1).
let session: TranscriptionSession | null = null;
let target: WebContents | null = null;
let meetingId: number | null = null;
/**
 * Last language detected by Deepgram for the current (or most recent) session.
 * Reset on start. Read by ipc/enhancer to resolve the enhancement output language.
 */
let detectedLanguage: string | null = null;
export function getDetectedLanguage(): string | null {
  return detectedLanguage;
}

// Audio duration tracking for Deepgram cost estimation (ROADMAP_01 §3).
// PCM frames are Int16Array (2 bytes/sample), channels = audioChannels.
// Duration (ms) = (byteLength / 2 / channels / sampleRate) * 1000
let audioSampleRate = 0;
let audioChannels = 0;
let audioMs = 0;

// ─── Mic-energy "Me" attribution (V05 ROADMAP_02) ───────────────────────────
// In single-channel (mono) mode the cloud diarizer labels everyone "Speaker N".
// We recover the local user from the per-frame mic vs system RMS levels the worklet
// sends (see me-attribution.ts for the pure heuristic). These are scalar levels,
// never audio bytes (§1.1).
let energyTimeline: EnergySample[] = [];
// Bound memory on marathon sessions; 200k samples ≈ 5.5h at 10 Hz. Cleared per session.
const ENERGY_TIMELINE_CAP = 200_000;

/** Apply "Me" attribution, but only in single-channel mode. */
function attributeSpeaker(seg: TranscriptSegment): TranscriptSegment {
  if (audioChannels !== 1) return seg;
  return attributeMe(seg, energyTimeline);
}

export function registerTranscriptionIpc(): void {
  ipcMain.handle(IPC.transcriptionStart, async (event, raw) => {
    const opts = TranscriptionStartSchema.parse(raw);
    target = event.sender;
    meetingId = opts.meetingId;
    detectedLanguage = null; // reset for new session
    audioSampleRate = opts.sampleRate;
    audioChannels = opts.channels;
    audioMs = 0;
    energyTimeline = [];
    if (session) {
      await session.stop();
      session = null;
    }
    const next = createTranscriptionSession({
      onSegment: (seg) => {
        // Single-channel mode: recover "Me" from the mic-energy signal before persist.
        // In single-channel mode this path now only sees interim segments — Deepgram
        // routes single-channel finals to onWords (V062 ROADMAP_01).
        const out = attributeSpeaker(seg);
        if (out.isFinal && meetingId !== null) insertTranscriptSegment(meetingId, out);
        target?.send(IPC.transcriptionSegment, out);
      },
      onWords: (words) => {
        // V062 ROADMAP_01: per-word "Me" attribution against the energy timeline,
        // then regroup with attribution as the primary partition key so own-voice
        // coalesces into one "Me" run even when Deepgram fragmented it across
        // multiple speaker IDs. Single-channel-final path only.
        if (audioChannels !== 1) return;
        const attributed = attributeWords(words, energyTimeline);
        const segs = groupAttributedWords(attributed);
        for (const seg of segs) {
          if (meetingId !== null) insertTranscriptSegment(meetingId, seg);
          target?.send(IPC.transcriptionSegment, seg);
        }
      },
      onStatus: (status) => target?.send(IPC.transcriptionStatus, status),
      onLanguageDetected: (bcp47) => {
        detectedLanguage = bcp47;
        target?.send(IPC.transcriptionLanguageDetected, { bcp47 });
      },
    });
    await next.start({ sampleRate: opts.sampleRate, channels: opts.channels });
    session = next;
    logger.info('transcription started', `meeting=${opts.meetingId}`);
  });

  ipcMain.handle(IPC.transcriptionStop, async () => {
    await session?.stop();
    session = null;
    // Save accumulated Deepgram audio duration + billed channel count for cost tracking.
    if (meetingId !== null && audioMs > 0) {
      try {
        saveDeepgramUsage(meetingId, audioMs, audioChannels);
      } catch (e) {
        logger.info('failed to save deepgram usage', String(e));
      }
    }
    meetingId = null;
    audioMs = 0;
    energyTimeline = [];
    logger.info('transcription stopped');
  });

  ipcMain.on(
    IPC.transcriptionPushFrame,
    (_event, buf: ArrayBuffer, micLevel?: number, sysLevel?: number) => {
      if (!session) return;
      // Record the per-frame mic/system levels keyed to the current audio offset, so
      // segment time windows can be classified for "Me" attribution (V05 ROADMAP_02).
      // tMs uses audioMs *before* this frame — the same origin as Deepgram timestamps.
      if (typeof micLevel === 'number' && typeof sysLevel === 'number') {
        energyTimeline.push({ tMs: audioMs, mic: micLevel, sys: sysLevel });
        if (energyTimeline.length > ENERGY_TIMELINE_CAP) {
          energyTimeline.splice(0, energyTimeline.length - ENERGY_TIMELINE_CAP);
        }
      }
      // Accumulate audio duration for cost estimation (ROADMAP_01 §3).
      if (audioSampleRate > 0 && audioChannels > 0) {
        audioMs += (buf.byteLength / 2 / audioChannels / audioSampleRate) * 1000;
      }
      session.pushAudio(new Int16Array(buf));
    },
  );
}

export async function disposeTranscription(): Promise<void> {
  await session?.stop();
  session = null;
  if (meetingId !== null && audioMs > 0) {
    try {
      saveDeepgramUsage(meetingId, audioMs, audioChannels);
    } catch {
      /* best effort */
    }
  }
  meetingId = null;
  audioMs = 0;
  energyTimeline = [];
}
