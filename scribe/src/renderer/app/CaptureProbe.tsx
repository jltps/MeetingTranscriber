import type { AudioCaptureController } from '../audio/use-audio-capture';

const MIC_ACCENT = '#39d98a';
const SYS_ACCENT = '#f6c453';

function Meter({ label, level, accent }: { label: string; level: number; accent: string }) {
  // Perceptual scaling (matches the M1 reference) so quiet speech is still visible.
  const pct = Math.min(100, Math.round(Math.pow(level, 0.6) * 140));
  const db = level <= 0 ? -Infinity : 20 * Math.log10(level);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs tracking-wide">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {db === -Infinity ? '−∞' : db.toFixed(0)} dB
        </span>
      </div>
      <div className="h-5 overflow-hidden rounded-sm border border-border bg-background">
        <div
          className="h-full transition-[width] duration-75 ease-linear"
          style={{ width: `${pct}%`, backgroundColor: accent }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="bg-background px-3.5 py-3">
      <dt className="text-[11px] tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 tabular-nums ${ok ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </dd>
    </div>
  );
}

export function CaptureProbe({ controller }: { controller: AudioCaptureController }) {
  const { state, micLevel, sysLevel, frames, bytes, sampleRate, sysTrack, micFallbackStep, error } = controller;

  return (
    <div className="w-full rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-foreground">Capture diagnostics</h2>
        <span className="text-[11px] tracking-wide text-muted-foreground">M1</span>
      </div>

      <div className="mb-5 grid gap-4">
        <Meter label="CH0 — MIC (you)" level={micLevel} accent={MIC_ACCENT} />
        <Meter label="CH1 — SYSTEM (others)" level={sysLevel} accent={SYS_ACCENT} />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-muted">
        <Stat label="state" value={state} />
        <Stat
          label="sample rate"
          value={sampleRate === null ? '—' : `${sampleRate} Hz → 16000 Hz`}
          ok={sampleRate !== null}
        />
        <Stat label="frames · 100ms" value={String(frames)} />
        <Stat label="pcm streamed" value={`${(bytes / 1024).toFixed(0)} KB`} />
        <Stat label="saved to disk" value="0 bytes — never" ok />
        <Stat label="channels" value="2 · 16-bit PCM" />
      </dl>

      {sysTrack && (
        <p className="mt-4 text-xs text-muted-foreground">
          System loopback track:{' '}
          <span className="text-muted-foreground">{sysTrack.label || 'unnamed'}</span> · {sysTrack.readyState} ·{' '}
          {sysTrack.muted ? (
            <span className="text-warning">muted — source is delivering silence</span>
          ) : (
            <span className="text-primary">unmuted</span>
          )}
          {!sysTrack.enabled && <span className="text-warning"> · disabled</span>}
        </p>
      )}

      {micFallbackStep === 'system-default' && (
        <p className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          Your selected microphone wasn&apos;t available — capture fell back to the Windows system
          default. Re-pick a device in Settings if this is wrong.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Speak into your mic and <b className="text-muted-foreground">CH0</b> moves; play any audio (a
        video or a real call) and <b className="text-muted-foreground">CH1</b> moves. System capture
        includes everything your PC plays — music and notifications get captured too. If CH1 stays
        flat, confirm Settings → System → Sound → Output matches the device you hear the call on.
      </p>
    </div>
  );
}
