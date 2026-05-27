// First-run privacy notice (PRODUCT_SPEC.md §7). Blocks the app until accepted;
// the accepted flag is persisted so it shows only once.
export function PrivacyNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Before you start</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Scribe captures your microphone and your computer’s system audio, and streams it for
          transcription. Here’s exactly what that means:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>
            • <b className="text-foreground">Audio is sent to Deepgram</b> for live transcription,
            and never stored — frames are dropped the moment they’re transcribed.
          </li>
          <li>
            • <b className="text-foreground">Transcript text and your notes are sent to Anthropic</b>{' '}
            (Claude) only when you enhance a meeting.
          </li>
          <li>
            • Nothing is sent anywhere else. Notes, transcripts, and settings stay in a local
            database on this machine.
          </li>
          <li>
            • Capture works at the OS level — Scribe never joins your call as a participant. Tell
            others present that you’re transcribing.
          </li>
        </ul>
        <button
          type="button"
          onClick={onAccept}
          className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          I understand
        </button>
      </div>
    </div>
  );
}
