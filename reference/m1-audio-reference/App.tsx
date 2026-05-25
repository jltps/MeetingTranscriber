import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioCapture, type CaptureFrame, type CaptureState } from './audio/capture';

function Meter({ label, level, accent }: { label: string; level: number; accent: string }) {
  const pct = Math.min(100, Math.round(Math.pow(level, 0.6) * 140));
  const db = level <= 0 ? -Infinity : 20 * Math.log10(level);
  return (
    <div className="meter">
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__db">{db === -Infinity ? '-\u221e' : db.toFixed(0)} dB</span>
      </div>
      <div className="meter__track">
        <div className="meter__fill" style={{ width: `${pct}%`, background: accent }} />
        <div className="meter__ticks" />
      </div>
    </div>
  );
}

export default function App() {
  const captureRef = useRef<AudioCapture | null>(null);
  const micS = useRef(0);
  const sysS = useRef(0);

  const [state, setState] = useState<CaptureState>('idle');
  const [mic, setMic] = useState(0);
  const [sys, setSys] = useState(0);
  const [frames, setFrames] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onFrame = useCallback((f: CaptureFrame) => {
    // Peak-hold with decay for a meter that reads naturally.
    micS.current = Math.max(f.micLevel, micS.current * 0.82);
    sysS.current = Math.max(f.sysLevel, sysS.current * 0.82);
    setMic(micS.current);
    setSys(sysS.current);
    setFrames((n) => n + 1);
    setBytes((n) => n + f.pcm.byteLength);
    // The PCM ArrayBuffer is intentionally DROPPED here. Nothing is written to
    // disk. In M2 this line forwards it to the main process for transcription.
  }, []);

  useEffect(() => {
    captureRef.current = new AudioCapture({
      onFrame,
      onError: (e) => setError(e.message),
      onState: setState,
    });
    return () => {
      void captureRef.current?.stop();
    };
  }, [onFrame]);

  const start = async () => {
    setError(null);
    setFrames(0);
    setBytes(0);
    try {
      await captureRef.current?.start();
    } catch {
      /* surfaced via onError */
    }
  };

  const stop = async () => {
    await captureRef.current?.stop();
    micS.current = 0;
    sysS.current = 0;
    setMic(0);
    setSys(0);
  };

  const running = state === 'running';

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="bar">
        <span className={`dot ${running ? 'on' : ''}`} />
        <h1>SCRIBE</h1>
        <span className="sub">m1 · audio capture probe</span>
      </header>

      <div className="meters">
        <Meter label="CH0 — MIC (you)" level={mic} accent="#39d98a" />
        <Meter label="CH1 — SYSTEM (others)" level={sys} accent="#f6c453" />
      </div>

      <div className="controls">
        {!running ? (
          <button onClick={start} disabled={state === 'starting'}>
            {state === 'starting' ? 'starting\u2026' : 'start capture'}
          </button>
        ) : (
          <button className="stop" onClick={stop}>
            stop
          </button>
        )}
      </div>

      <dl className="stats">
        <div>
          <dt>state</dt>
          <dd>{state}</dd>
        </div>
        <div>
          <dt>frames · 100ms</dt>
          <dd>{frames}</dd>
        </div>
        <div>
          <dt>pcm streamed</dt>
          <dd>{(bytes / 1024).toFixed(0)} KB</dd>
        </div>
        <div>
          <dt>saved to disk</dt>
          <dd className="ok">0 bytes — never</dd>
        </div>
      </dl>

      {error && <p className="err">! {error}</p>}

      <p className="hint">
        Play any audio (a video, a call) and speak into your mic. <b>CH0</b> should move when
        you talk; <b>CH1</b> should move when your speakers/headphones play sound. If CH1 stays
        flat, system-audio output isn&rsquo;t being captured — confirm Settings &rarr; System
        &rarr; Sound &rarr; Output matches the device you hear the call on.
      </p>
    </div>
  );
}

const CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #0b0e12; }
  .app {
    font: 13px/1.5 ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    color: #c8d2dc; padding: 22px; min-height: 100vh;
    background:
      radial-gradient(900px 500px at 80% -10%, rgba(57,217,138,.06), transparent 60%),
      #0b0e12;
    user-select: none;
  }
  .bar { display: flex; align-items: baseline; gap: 10px; padding-bottom: 18px;
         border-bottom: 1px solid #1b222c; margin-bottom: 22px; }
  .bar h1 { font-size: 15px; letter-spacing: .28em; color: #eef3f8; font-weight: 600; }
  .bar .sub { color: #5d6b7a; letter-spacing: .12em; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #39414c;
         align-self: center; transition: .25s; }
  .dot.on { background: #ff4d4d; box-shadow: 0 0 0 0 rgba(255,77,77,.6);
            animation: pulse 1.4s infinite; }
  @keyframes pulse { 70% { box-shadow: 0 0 0 7px rgba(255,77,77,0); } }

  .meters { display: grid; gap: 18px; margin-bottom: 26px; }
  .meter__head { display: flex; justify-content: space-between; margin-bottom: 7px;
                 letter-spacing: .1em; }
  .meter__label { color: #93a1b0; }
  .meter__db { color: #5d6b7a; font-variant-numeric: tabular-nums; }
  .meter__track { position: relative; height: 22px; background: #11161d;
                  border: 1px solid #1b222c; border-radius: 3px; overflow: hidden; }
  .meter__fill { height: 100%; border-radius: 2px; transition: width .06s linear; }
  .meter__ticks { position: absolute; inset: 0; pointer-events: none;
    background-image: repeating-linear-gradient(90deg, transparent 0 9px, rgba(11,14,18,.55) 9px 10px); }

  .controls { margin-bottom: 26px; }
  button { font: inherit; letter-spacing: .12em; cursor: pointer; padding: 11px 22px;
    color: #0b0e12; background: #39d98a; border: 0; border-radius: 3px; font-weight: 600; }
  button:hover { filter: brightness(1.07); }
  button:disabled { opacity: .55; cursor: default; }
  button.stop { background: #ff4d4d; color: #fff; }

  .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px;
    background: #1b222c; border: 1px solid #1b222c; border-radius: 4px; overflow: hidden; }
  .stats > div { background: #0e131a; padding: 12px 14px; }
  .stats dt { color: #5d6b7a; letter-spacing: .1em; font-size: 11px; }
  .stats dd { color: #eef3f8; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .stats dd.ok { color: #39d98a; }

  .err { margin-top: 18px; color: #ff8e8e; background: rgba(255,77,77,.08);
    border: 1px solid rgba(255,77,77,.25); padding: 10px 12px; border-radius: 4px; }
  .hint { margin-top: 22px; color: #6b7888; line-height: 1.7; }
  .hint b { color: #93a1b0; }
`;
