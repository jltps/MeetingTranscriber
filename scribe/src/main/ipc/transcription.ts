import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { IPC, TranscriptionStartSchema } from '../../shared/ipc-contract';
import type { TranscriptionWarning } from '../../shared/ipc-contract';
import type { TranscriptSegment } from '../../shared/types';
import { createTranscriptionSession } from '../transcription';
import type { TranscriptionSession } from '../transcription/session';
import type { ProviderInsights } from '../transcription/parse-gladia';
import { reconcileInsights } from '../transcription/insights-reconcile';
import {
  attributeMe,
  attributeWords,
  groupAttributedWords,
  type EnergySample,
} from '../transcription/me-attribution';
import { getAudioCaptureMode, getTranscriptionProvider } from '../db/settings';
import type { TranscriptionProvider } from '../db/settings';
import { getTranscript, insertTranscriptSegment, saveDeepgramUsage } from '../db/meetings';
import { saveInsights, setInsightsError, setInsightsProcessing } from '../db/insights';
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

/**
 * Whether a transcription session is active right now. Used by the updater's
 * install guard (V07) so we never `quitAndInstall` mid-meeting (§1.5).
 */
export function isTranscriptionActive(): boolean {
  return session !== null;
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
/** Capture mode (V073) snapshot for the current session. */
let captureMode: ReturnType<typeof getAudioCaptureMode> = 'auto';
/** Provider snapshot for the current session (V08) — selects the stop/usage path. */
let activeProvider: TranscriptionProvider = 'deepgram';
/**
 * Gladia sessions kept alive after stop() while they post-process insights
 * (V08). The session removes itself once `onInsights` finalizes; dispose drains
 * any stragglers so app close leaves no dangling sockets.
 */
const enriching = new Set<TranscriptionSession>();

/** Apply "Me" attribution, but only in single-channel mode. */
function attributeSpeaker(seg: TranscriptSegment): TranscriptSegment {
  if (audioChannels !== 1) return seg;
  return attributeMe(seg, energyTimeline, { captureMode });
}

// ─── In-meeting silence watchdog (V073 block 01.5) ──────────────────────────
// Counts non-silent frames per channel during a session; if neither side has
// produced signal a few seconds in, push a one-shot warning so the UI can
// surface "Microphone silent — check your input device" (and clear it on signal).
const WATCHDOG_GRACE_MS = 3000;
const WATCHDOG_RMS_FLOOR = 0.005;
let sessionStartedAt = 0;
let micSignalFrames = 0;
let sysSignalFrames = 0;
let watchdogFiredKind: TranscriptionWarning['kind'] | null = null;

function pushWarning(warn: TranscriptionWarning): void {
  target?.send(IPC.transcriptionWarning, warn);
}

function checkWatchdog(micLevel: number, sysLevel: number): void {
  if (micLevel >= WATCHDOG_RMS_FLOOR) micSignalFrames++;
  if (sysLevel >= WATCHDOG_RMS_FLOOR) sysSignalFrames++;
  const elapsed = Date.now() - sessionStartedAt;
  if (elapsed < WATCHDOG_GRACE_MS) return;
  if (watchdogFiredKind === null) {
    if (micSignalFrames === 0) {
      watchdogFiredKind = 'mic-silent';
      pushWarning({
        kind: 'mic-silent',
        message:
          'No microphone signal detected. Check Settings → Audio, and confirm Windows allows app mic access.',
      });
    } else if (sysSignalFrames === 0) {
      watchdogFiredKind = 'system-silent';
      pushWarning({
        kind: 'system-silent',
        message:
          'No system audio detected. Make sure the call is playing on the same output device Windows is using.',
      });
    }
  } else if (
    (watchdogFiredKind === 'mic-silent' && micSignalFrames > 0) ||
    (watchdogFiredKind === 'system-silent' && sysSignalFrames > 0)
  ) {
    watchdogFiredKind = null;
    pushWarning({ kind: 'cleared', message: 'Audio is back.' });
  }
}

function resetWatchdog(): void {
  sessionStartedAt = Date.now();
  micSignalFrames = 0;
  sysSignalFrames = 0;
  watchdogFiredKind = null;
}

/**
 * V08: reconcile Gladia's post-call insights against the persisted transcript
 * (the authoritative "Me"/speaker source — the energy timeline is cleared on
 * stop), persist, and notify the renderer. Always releases the retained session.
 */
function finalizeInsights(
  forMeetingId: number,
  forTarget: WebContents | null,
  insights: ProviderInsights,
  ownerSession: TranscriptionSession,
): void {
  try {
    const segments = getTranscript(forMeetingId);
    const normalized = reconcileInsights(insights, segments);
    const ids = ownerSession.sessionIds?.() ?? [];
    saveInsights(forMeetingId, normalized, ids);
    forTarget?.send(IPC.transcriptionInsightsStatus, { meetingId: forMeetingId, status: 'ready' });
    logger.info('gladia insights ready', `meeting=${forMeetingId}`);
  } catch (e) {
    logger.info('failed to finalize gladia insights', String(e));
    try {
      setInsightsError(forMeetingId, e instanceof Error ? e.message : String(e));
    } catch {
      /* best effort */
    }
    forTarget?.send(IPC.transcriptionInsightsStatus, { meetingId: forMeetingId, status: 'error' });
  } finally {
    enriching.delete(ownerSession);
  }
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
    captureMode = getAudioCaptureMode();
    activeProvider = getTranscriptionProvider();
    resetWatchdog();
    if (session) {
      await session.stop();
      session = null;
    }
    // Captured for the post-stop insights callback (V08): the module-level
    // `meetingId`/`target` are nulled on stop, but Gladia's onInsights fires
    // later, so bind this session's values here.
    const enrichMeetingId = opts.meetingId;
    const enrichTarget = event.sender;
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
        // multiple speaker IDs. Single-channel-final path only. V073: pass the
        // session captureMode so the bleed-aware dominance threshold kicks in.
        if (audioChannels !== 1) return;
        const attributed = attributeWords(words, energyTimeline, { captureMode });
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
      // V08: Gladia delivers diarization/NER/sentiment after the call ends.
      // Reconcile + persist against the captured meeting (the energy timeline is
      // gone by then). Only wired for providers that emit it (Gladia).
      onInsights: (insights) => {
        finalizeInsights(enrichMeetingId, enrichTarget, insights, next);
      },
    });
    await next.start({ sampleRate: opts.sampleRate, channels: opts.channels });
    session = next;
    logger.info('transcription started', `meeting=${opts.meetingId}`);
  });

  ipcMain.handle(IPC.transcriptionStop, async () => {
    const stopping = session;
    const stopProvider = activeProvider;
    const stopMeetingId = meetingId;
    const stopTarget = target;
    await stopping?.stop();
    session = null;
    // Save accumulated STT audio duration + billed channel count for cost tracking.
    if (stopMeetingId !== null && audioMs > 0) {
      try {
        saveDeepgramUsage(stopMeetingId, audioMs, audioChannels, stopProvider);
      } catch (e) {
        logger.info('failed to save stt usage', String(e));
      }
    }
    // V08: Gladia keeps post-processing after stop() — its socket stays alive
    // internally until insights are ready. Retain the session, mark the meeting
    // "analysing", and let onInsights finalize later. Other providers are fully
    // torn down by stop().
    if (stopProvider === 'gladia' && stopping && stopMeetingId !== null) {
      enriching.add(stopping);
      const ids = stopping.sessionIds?.() ?? [];
      try {
        setInsightsProcessing(stopMeetingId, 'gladia', ids);
      } catch (e) {
        logger.info('failed to mark insights processing', String(e));
      }
      stopTarget?.send(IPC.transcriptionInsightsStatus, {
        meetingId: stopMeetingId,
        status: 'processing',
      });
    }
    meetingId = null;
    audioMs = 0;
    energyTimeline = [];
    resetWatchdog();
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
        checkWatchdog(micLevel, sysLevel);
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
  const active = session;
  await active?.stop();
  session = null;
  if (meetingId !== null && audioMs > 0) {
    try {
      saveDeepgramUsage(meetingId, audioMs, audioChannels, activeProvider);
    } catch {
      /* best effort */
    }
  }
  // V08: hard-tear-down any retained Gladia sessions (and the just-stopped one)
  // so app close leaves no dangling sockets; boot-resume recovers their insights.
  active?.abort?.();
  for (const s of enriching) {
    try {
      s.abort?.();
    } catch {
      /* best effort */
    }
  }
  enriching.clear();
  meetingId = null;
  audioMs = 0;
  energyTimeline = [];
}
