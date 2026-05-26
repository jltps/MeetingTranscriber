// First-run privacy notice (PRODUCT_SPEC.md §7). Blocks the app until accepted;
// the accepted flag is persisted so it shows only once.
export function PrivacyNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-lg font-semibold text-neutral-100">Before you start</h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-300">
          Scribe captures your microphone and your computer’s system audio, and streams it for
          transcription. Here’s exactly what that means:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
          <li>
            • <b className="text-neutral-100">Audio is sent to Deepgram</b> for live transcription,
            and never stored — frames are dropped the moment they’re transcribed.
          </li>
          <li>
            • <b className="text-neutral-100">Transcript text and your notes are sent to Anthropic</b>{' '}
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
          className="mt-6 w-full rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-300"
        >
          I understand
        </button>
      </div>
    </div>
  );
}
