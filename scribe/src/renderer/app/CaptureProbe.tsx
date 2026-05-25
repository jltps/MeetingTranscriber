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
        <span className="text-neutral-400">{label}</span>
        <span className="tabular-nums text-neutral-500">
          {db === -Infinity ? '−∞' : db.toFixed(0)} dB
        </span>
      </div>
      <div className="h-5 overflow-hidden rounded-sm border border-neutral-800 bg-neutral-950">
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
    <div className="bg-neutral-950 px-3.5 py-3">
      <dt className="text-[11px] tracking-wide text-neutral-500">{label}</dt>
      <dd className={`mt-1 tabular-nums ${ok ? 'text-emerald-400' : 'text-neutral-100'}`}>
        {value}
      </dd>
    </div>
  );
}

export function CaptureProbe({ controller }: { controller: AudioCaptureController }) {
  const { state, micLevel, sysLevel, frames, bytes, sampleRate, sysTrack, error } = controller;
  const rateWarning = sampleRate !== null && sampleRate !== 16000;

  return (
    <div className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-200">Capture diagnostics</h2>
        <span className="text-[11px] tracking-wide text-neutral-600">M1</span>
      </div>

      <div className="mb-5 grid gap-4">
        <Meter label="CH0 — MIC (you)" level={micLevel} accent={MIC_ACCENT} />
        <Meter label="CH1 — SYSTEM (others)" level={sysLevel} accent={SYS_ACCENT} />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-neutral-800 bg-neutral-800">
        <Stat label="state" value={state} />
        <Stat
          label="sample rate"
          value={sampleRate === null ? '—' : `${sampleRate} Hz`}
          ok={sampleRate === 16000}
        />
        <Stat label="frames · 100ms" value={String(frames)} />
        <Stat label="pcm streamed" value={`${(bytes / 1024).toFixed(0)} KB`} />
        <Stat label="saved to disk" value="0 bytes — never" ok />
        <Stat label="channels" value="2 · 16-bit PCM" />
      </dl>

      {sysTrack && (
        <p className="mt-4 text-xs text-neutral-500">
          System loopback track:{' '}
          <span className="text-neutral-300">{sysTrack.label || 'unnamed'}</span> · {sysTrack.readyState} ·{' '}
          {sysTrack.muted ? (
            <span className="text-amber-400">muted — source is delivering silence</span>
          ) : (
            <span className="text-emerald-400">unmuted</span>
          )}
          {!sysTrack.enabled && <span className="text-amber-400"> · disabled</span>}
        </p>
      )}

      {rateWarning && (
        <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
          Driver returned {sampleRate} Hz instead of 16000 Hz. Capture still runs, but PCM is not
          at the target rate — a fallback resampler arrives in M2.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
          {error}
        </p>
      )}

      <p className="mt-5 text-xs leading-relaxed text-neutral-500">
        Speak into your mic and <b className="text-neutral-400">CH0</b> moves; play any audio (a
        video or a real call) and <b className="text-neutral-400">CH1</b> moves. System capture
        includes everything your PC plays — music and notifications get captured too. If CH1 stays
        flat, confirm Settings → System → Sound → Output matches the device you hear the call on.
      </p>
    </div>
  );
}
