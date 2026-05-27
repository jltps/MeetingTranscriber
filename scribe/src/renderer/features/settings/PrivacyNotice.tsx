import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// First-run privacy notice (PRODUCT_SPEC.md §7). Blocks the app until accepted;
// the accepted flag is persisted so it shows only once. This is a hard gate — it
// cannot be dismissed by Escape, overlay click, or a close button; the only way
// out is the explicit "I understand" action.
export function PrivacyNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Before you start</DialogTitle>
          <DialogDescription>
            Scribe captures your microphone and your computer’s system audio, and streams it for
            transcription. Here’s exactly what that means:
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-muted-foreground">
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
        <Button onClick={onAccept} className="w-full">
          I understand
        </Button>
      </DialogContent>
    </Dialog>
  );
}
