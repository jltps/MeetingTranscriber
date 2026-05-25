import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { IPC, TranscriptionStartSchema } from '../../shared/ipc-contract';
import { createTranscriptionSession } from '../transcription';
import type { TranscriptionSession } from '../transcription/session';
import { logger } from '../logger';

// One active session at a time. Control messages (start/stop) are Zod-validated;
// the high-frequency pushFrame channel carries a raw ArrayBuffer and is NOT
// validated per-frame (CLAUDE.md §4). Audio frames go straight to the socket and
// are never buffered or written to disk (§1.1).
let session: TranscriptionSession | null = null;
let target: WebContents | null = null;

export function registerTranscriptionIpc(): void {
  ipcMain.handle(IPC.transcriptionStart, async (event, raw) => {
    const opts = TranscriptionStartSchema.parse(raw);
    target = event.sender;
    if (session) {
      await session.stop();
      session = null;
    }
    const next = createTranscriptionSession({
      onSegment: (seg) => target?.send(IPC.transcriptionSegment, seg),
      onStatus: (status) => target?.send(IPC.transcriptionStatus, status),
    });
    await next.start(opts); // rejects on missing key / auth failure
    session = next;
    logger.info('transcription started', `${opts.channels}ch @ ${opts.sampleRate}Hz`);
  });

  ipcMain.handle(IPC.transcriptionStop, async () => {
    await session?.stop();
    session = null;
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
}
