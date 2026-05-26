import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { IPC, TranscriptionStartSchema } from '../../shared/ipc-contract';
import { createTranscriptionSession } from '../transcription';
import type { TranscriptionSession } from '../transcription/session';
import { insertTranscriptSegment } from '../db/meetings';
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

export function registerTranscriptionIpc(): void {
  ipcMain.handle(IPC.transcriptionStart, async (event, raw) => {
    const opts = TranscriptionStartSchema.parse(raw);
    target = event.sender;
    meetingId = opts.meetingId;
    detectedLanguage = null; // reset for new session
    if (session) {
      await session.stop();
      session = null;
    }
    const next = createTranscriptionSession({
      onSegment: (seg) => {
        if (seg.isFinal && meetingId !== null) insertTranscriptSegment(meetingId, seg);
        target?.send(IPC.transcriptionSegment, seg);
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
    meetingId = null;
    logger.info('transcription stopped');
  });

  ipcMain.on(IPC.transcriptionPushFrame, (_event, buf: ArrayBuffer) => {
    if (!session) return;
    session.pushAudio(new Int16Array(buf));
  });
}

export async function disposeTranscription(): Promise<void> {
  await session?.stop();
  session = null;
  meetingId = null;
}
