# PRODUCT_SPEC.md — "Scribe" (working title)

> A bot-free, device-audio meeting notepad for Windows. It captures the full
> meeting conversation by transcribing your computer's audio locally-routed,
> lets you take rough notes live, and after the meeting merges your notes with
> an AI-enhanced summary — without ever joining the call as a participant and
> without storing any audio.

This document was the single source of truth for building v1. It is written to be
fed to Claude Code. Build in the milestone order given in §11. Do not skip the
non-goals in §3 — they existed to keep v1 shippable.

> **Status (historical document).** v1 (§11, milestones M0–M6) is **shipped**. The
> app is at v0.3.0 and has since absorbed most of the §3 non-goals and §13 roadmap:
> multi-language + auto-detect, enhancement prompt control + templates, reliability
> hardening + usage/cost, speaker naming, export/backup, local Whisper, calendar
> (Google + Microsoft, free/busy only), and cross-meeting chat are all built. This
> file is kept as the **original v1 intent**; for *how* the code should behave today
> see `CLAUDE.md`, for shipped-feature specs see `roadmap/v02` and `roadmap/v03`, and
> for the live overview see `README.md`. Where this spec and the code disagree, **the
> code wins** (CLAUDE.md). §3 and §13 are annotated below with what has since shipped.

---

## 1. Product vision

Most meeting tools join your call as a bot to record it. That announces itself,
changes how people talk, and creates a separate audio recording you now have to
worry about. This product takes the opposite approach, modeled on Granola:

- **No bot ever joins the meeting.** We capture audio at the operating-system
  level (system/loopback audio + microphone), so the app works with *any*
  conferencing tool — Zoom, Teams, Meet, Slack huddles, plain VoIP — because it
  never integrates with them. It just listens to what your computer plays and
  what your mic hears.
- **The human stays in charge of the notes.** You jot quick, rough notes during
  the call. The AI's job is to *flesh those out* using the full transcript, not
  to replace them.
- **No audio is ever stored.** Audio is captured, streamed for transcription,
  and discarded in-flight. Only the transcript text and your notes are persisted.

The core promise that defines this product: **it captures the full meeting
transcription without any meeting agent/bot.**

## 2. Target user & platform

- Single user, running on their own Windows machine.
- **Windows 10 and Windows 11, 64-bit.** No macOS, web, mobile, or Android in v1.
- Local-first, single-user. No accounts, no login, no multi-tenant.

## 3. Non-goals for v1 (explicitly out of scope)

These were deliberately deferred out of v1. They were listed in §13 as the roadmap
so the architecture could leave room for them. **Many have since shipped** —
annotations mark which:

- ✅ Calendar integration / auto-start at scheduled meeting time. *(Shipped:
  ROADMAP_06 — Google + Microsoft, free/busy only.)*
- ✅ Note templates (Interview, Stand-up, etc.). *(Shipped: `roadmap/v02` — named,
  editable enhancement templates.)*
- ✅ Cross-meeting / folder-level querying ("what came up across my last 5 calls").
  *(Shipped: ROADMAP_07 Phase 2.)*
- ✅ Post-meeting conversational AI chat about a meeting. *(Shipped: ROADMAP_07
  Phase 1.)*
- ❌ User accounts, authentication, cloud sync, sharing, collaboration. *(Still
  deferred — export/backup shipped, but sync/sharing did not.)*
- ❌ Audio recording / playback (we discard audio by design — see §7). *(Permanent
  non-goal — a §1 invariant in CLAUDE.md.)*
- ✅ Local/offline transcription. *(Shipped: ROADMAP_05 — local Whisper via
  `@xenova/transformers`, behind the §6.2 interface.)*
- ❌ Installer/auto-update polish (a runnable packaged dev build is enough; see §11 M6).
- ❌ macOS support (architecture should not hard-block it, but do not build it).

## 4. Core user flow (the "happy path")

1. User opens the app. Sees a list of past meetings (left sidebar) and a big
   **"New Note"** button.
2. User clicks **New Note**. A new meeting note opens with an empty notes editor
   and a **"Start transcription"** control.
3. User clicks **Start**. The app begins capturing **system audio + microphone**,
   streams it to the transcription service, and shows a **live transcript** panel
   updating in real time, with speaker labels.
4. While the call happens, the user types **rough notes** in the editor. These are
   their own words (rendered in the normal/"my notes" style).
5. User clicks **Stop** (or closes the meeting). Capture ends immediately; audio
   buffers are discarded.
6. The app sends {user notes + full transcript} to the LLM and produces
   **enhanced notes**: the user's notes fleshed out with structure, key points,
   decisions, and action items drawn from the transcript.
7. The enhanced view shows a clear **visual distinction** between what the user
   wrote and what the AI added (see §8.3).
8. The user can click a **source icon** next to any AI-generated point to jump to
   the exact transcript segment it came from (see §8.4).
9. Everything (notes, enhanced notes, transcript) is saved locally and searchable
   from the sidebar.

## 5. Tech stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Shell | **Electron** (latest stable, ≥ v31) | Required: v31+ gives us loopback system-audio capture without a native WASAPI addon (see §6.1). |
| UI | **React + TypeScript + Vite** | Renderer process. |
| Styling | Tailwind CSS | Keep it clean and minimal — Granola-like calm UI. |
| Editor | **TipTap** (ProseMirror) or Lexical | Rich-text notes with custom marks for the my-notes vs AI distinction. TipTap recommended. |
| Local DB | **SQLite** via `better-sqlite3` | Synchronous, runs in main process. |
| Audio processing | Web Audio API + **AudioWorklet** | Mixing, resampling to 16 kHz mono PCM in the renderer. |
| Transcription | **Deepgram** streaming API (WebSocket) | Cloud, real-time, diarization + multichannel. Behind an interface (§6.2). |
| AI enhancement | **Anthropic Claude API** | `claude-sonnet-4-5` or current Sonnet. Behind an interface (§9). |
| IPC | Electron `contextBridge` + `ipcRenderer/ipcMain` | Strict context isolation; no `nodeIntegration` in renderer. |
| Packaging | `electron-builder` (NSIS target) | Only at milestone M6. |

User supplies their own **Deepgram** and **Anthropic** API keys via the Settings
screen (§10). Paid API usage is acceptable.

### 5.1 Process architecture

- **Main process**: window lifecycle, SQLite access, secrets/keychain, the
  `setDisplayMediaRequestHandler` that grants loopback audio, the Anthropic API
  calls (so the key never touches the renderer), and the WebSocket-to-Deepgram
  relay if we choose to proxy (see §6.3).
- **Renderer process**: React UI, audio capture + mixing + resampling via Web
  Audio/AudioWorklet, note editing.
- **Preload**: a typed, minimal `window.api` bridge exposing only the IPC
  channels the renderer needs. No raw `ipcRenderer`, no Node globals.

## 6. Audio capture & transcription (the hard part — read carefully)

This is the make-or-break subsystem. Get it right first.

### 6.1 Capturing system audio + microphone on Windows

We need two simultaneous audio sources:

1. **Microphone** (the local user's voice):
   `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } })`.

2. **System / loopback audio** (everyone else in the call, as heard through the
   user's speakers/headphones):
   Use Electron's display-media loopback support. In the **main process**:

   ```ts
   // Chromium requires a video source to be offered for getDisplayMedia, so we
   // hand it a screen source and let the renderer discard the video track. We
   // cannot pass `video: undefined` as earlier drafts suggested.
   session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
     desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
       callback({ video: sources[0], audio: 'loopback' }); // 'loopback' = WASAPI system mix
     });
   }, { useSystemPicker: false });
   ```

   Then in the **renderer**:

   ```ts
   const systemStream = await navigator.mediaDevices.getDisplayMedia({
     audio: true,
     video: true, // Chromium requires a video track to be requested; we drop it immediately
   });
   systemStream.getVideoTracks().forEach(t => t.stop()); // discard video; keep audio only
   ```

   > Why this approach: Electron ≥ v31 supports `audio: 'loopback'` in the display
   > media handler, which captures the Windows system audio mix via WASAPI loopback
   > under the hood — **without** us shipping or compiling a native addon. This is
   > the primary path. If loopback audio proves unreliable on a target machine, the
   > fallback is a native `better-sqlite3`-style N-API addon wrapping WASAPI
   > loopback, but **do not build the native addon in v1 unless the Electron path
   > demonstrably fails.**

   Important behavioral facts to honor (matching Granola's documented behavior):
   - We capture the **combined** system audio stream. We **cannot** isolate a
     single application's audio. If the user plays music, it will be transcribed.
     Surface this as a one-time tip, do not try to solve it.
   - If transcription captures the user's voice but not others, the usual cause is
     the system output device not matching the captured default output. Add a
     Settings note and a device picker (§10).

### 6.2 The transcription provider interface

Even though v1 ships only Deepgram, all transcription must go through an
interface so local Whisper can be added in v2 without touching the UI:

```ts
interface TranscriptionSession {
  start(opts: { sampleRate: number; channels: number }): Promise<void>;
  pushAudio(pcm: Int16Array): void;          // 16-bit PCM frames
  onPartial(cb: (seg: TranscriptSegment) => void): void; // interim results
  onFinal(cb: (seg: TranscriptSegment) => void): void;   // finalized results
  stop(): Promise<void>;
}

type TranscriptSegment = {
  text: string;
  channel: 0 | 1;        // 0 = microphone (local user), 1 = system (remote)
  speakerLabel: string;  // "Me" for ch0; "Speaker 1/2/…" for ch1 via diarization
  startMs: number;
  endMs: number;
  isFinal: boolean;
};
```

### 6.3 Multichannel strategy (do this — it's what makes speaker labels good)

Send a **2-channel** stream to Deepgram, not a single mixed stream:

- **Channel 0 = microphone** → always attributed to **"Me"** (the local user).
- **Channel 1 = system audio** → enable Deepgram **diarization** on this channel
  to separate remote speakers ("Speaker 1", "Speaker 2", …).

Enable Deepgram options: `multichannel=true`, `diarize=true`, `punctuate=true`,
`interim_results=true`, `model=nova-3` (or current best), `encoding=linear16`,
`sample_rate=16000`. This gives reliable "me vs them" separation for free, since
we physically know which channel is the mic.

The renderer:
1. Creates one `AudioContext` **forced to 16 kHz** (`new AudioContext({ sampleRate:
   16000 })`). The browser resamples both inputs, so **no manual resampler is
   needed**. Rare drivers refuse the rate — detect `ctx.sampleRate !== 16000` and
   surface it rather than emitting bad PCM; M2 can add a worklet-side fallback
   resampler behind the same interface.
2. Wraps mic stream and system stream in `MediaStreamAudioSourceNode`s.
3. Feeds them into a **2-input `AudioWorkletProcessor`** (mic → input 0 → channel 0,
   system → input 1 → channel 1). This replaces the `ChannelMergerNode` of earlier
   drafts: it keeps the mic and system signals cleanly separated with fewer moving
   parts.
4. The worklet **interleaves** the two inputs into 16-bit PCM (`[mic, sys, mic, sys,
   …]`, the layout Deepgram multichannel `linear16` expects) and emits ~100 ms
   frames. No resampling happens here — the 16 kHz context already did it.
5. Frames are sent to the transcription session. **Key decision:** the Deepgram
   WebSocket should be opened from the **main process** (renderer posts PCM frames
   over IPC) so the API key never reaches the renderer. Acceptable alternative for
   v1: open it from the renderer with a short-lived key — but main-process relay is
   preferred for key safety.

### 6.4 Hard rule: no audio persistence

Audio frames live only in memory and only long enough to be sent for
transcription. **Never** write audio to disk, never buffer a full recording, never
expose a "save recording" path. On `stop()`, drop all audio buffers immediately.
Only `TranscriptSegment`s and notes are persisted.

## 7. Privacy & security requirements

- No audio at rest, ever (§6.4).
- All meeting data (notes, enhanced notes, transcripts, settings) stored **locally**
  in SQLite under the app's `userData` directory.
- API keys stored using the OS credential vault via Electron `safeStorage`
  (encrypts with Windows DPAPI). Never store keys in plaintext, never in the DB
  in plaintext, never in logs.
- Strict Electron hardening: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true` where feasible, a restrictive CSP, and
  `webContents.setWindowOpenHandler` to block arbitrary navigation.
- Audio is sent to Deepgram and transcript text to Anthropic. Make this explicit
  in a first-run privacy notice. Do not send anything to any other endpoint.
- The app must show a clear, always-visible **recording/transcribing indicator**
  whenever capture is active (ethical + matches user expectation that they should
  tell participants they're transcribing).

## 8. Notes & enhancement model

### 8.1 Live notes editor

- A clean rich-text editor (TipTap). Markdown-ish shortcuts, bullet lists,
  headings, checkboxes for action items.
- Auto-saves continuously to SQLite (debounced).
- Sits side-by-side (or tabbed on narrow widths) with the live transcript panel.

### 8.2 Live transcript panel

- Shows finalized segments with speaker labels and timestamps; interim results
  render in a lighter, in-progress style and get replaced when finalized.
- Auto-scrolls; user can scroll up to read back without fighting the auto-scroll.

### 8.3 Post-meeting enhancement (the signature feature)

On `stop()`:
1. Send `{ userNotes, fullTranscript }` to Claude (§9) with a prompt that:
   - Preserves and expands the user's notes (never discards their points).
   - Adds structure: headings, key points, decisions, **action items**.
   - Draws specifics (names, numbers, quotes) from the transcript.
2. Render the result with a **clear visual distinction** between user-authored
   content and AI-added content (Granola uses black for the user, gray for AI).
   Implement this as two TipTap marks: `myNote` and `aiNote`. Any AI text the user
   edits **flips to `myNote`** (it becomes theirs). This rule matters — implement it.
3. The original raw user notes and the AI-enhanced version are both stored, so the
   user can always see/recover what they originally typed.

### 8.4 Transcript source linking ("where did this come from?")

- Each AI-generated point carries references to the `transcript_segment` id(s) it
  was derived from.
- Render a small **source icon** (magnifying glass) next to AI points; clicking it
  scrolls the transcript panel to and highlights those segments.
- Implementation: instruct the LLM to return enhanced notes as structured JSON
  (array of blocks, each block carrying `sourceSegmentIds: number[]`), then render
  that to the editor. Do **not** parse free text to guess sources.

## 9. AI enhancement interface

```ts
interface Enhancer {
  enhance(input: {
    userNotes: string;            // markdown
    transcript: TranscriptSegment[];
  }): Promise<EnhancedNotes>;
}

type EnhancedNotes = {
  blocks: Array<{
    type: 'heading' | 'paragraph' | 'bullet' | 'action_item';
    text: string;
    origin: 'user' | 'ai';
    sourceSegmentIds: number[];   // empty for user-origin blocks
  }>;
};
```

- Implemented against the **Anthropic Claude API** in the **main process** (key
  safety). Use the current Sonnet model. `max_tokens` sized for long meetings;
  chunk/summarize transcripts that exceed the context window (summarize-then-merge
  for very long calls).
- Prompt lives in a single versioned file (`/src/main/enhancer/prompt.ts`) so it's
  easy to iterate. Require strict JSON output; validate with Zod; on parse failure,
  retry once, then fall back to a plain-markdown enhancement.

## 10. Settings screen

- **API keys**: Deepgram key, Anthropic key. Stored via `safeStorage`. "Test
  connection" buttons for each.
- **Audio devices**: pick microphone input; show detected default system output
  with the "make sure this matches your call's output" guidance.
- **Transcription language**: default auto/English in v1.
- **Privacy**: restate "no audio stored"; button to wipe all local data.

## 11. Data model (SQLite)

```sql
CREATE TABLE meetings (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT 'Untitled meeting',
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|transcribing|ended
  started_at    INTEGER,                          -- epoch ms
  ended_at      INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE notes (
  meeting_id        INTEGER PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
  raw_user_md       TEXT NOT NULL DEFAULT '',     -- exactly what the user typed
  enhanced_json     TEXT,                          -- EnhancedNotes JSON (§9)
  enhanced_at       INTEGER
);

CREATE TABLE transcript_segments (
  id            INTEGER PRIMARY KEY,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  channel       INTEGER NOT NULL,                  -- 0 mic / 1 system
  speaker_label TEXT NOT NULL,
  text          TEXT NOT NULL,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL
);
CREATE INDEX idx_segments_meeting ON transcript_segments(meeting_id, start_ms);

-- Full-text search over transcripts + notes for the sidebar search.
CREATE VIRTUAL TABLE search_fts USING fts5(meeting_id, content);
```

No `audio` table. There is intentionally nowhere to store audio.

## 12. Build milestones (build in this order)

- **M0 — Skeleton.** Electron + Vite + React + TS scaffold, hardened
  `BrowserWindow`, typed preload bridge, SQLite wired up, blank sidebar + editor.
- **M1 — Audio capture proof.** Get mic + loopback system audio both captured
  (§6.1), mixed into a 2-channel 16 kHz PCM stream via AudioWorklet, and verify
  frames flow. Visual VU meter for each channel to prove it works. **This is the
  riskiest milestone — do it early and prove it before building UI polish.**
- **M2 — Live transcription.** Deepgram streaming via the §6.2 interface, multichannel
  + diarization, live transcript panel with speaker labels + interim results.
- **M3 — Notes + persistence.** TipTap editor, autosave, meeting list, create/stop
  meeting lifecycle, transcript persisted, FTS search in sidebar.
- **M4 — Enhancement.** Claude integration (§9), structured JSON output, my-notes
  vs AI-notes rendering (§8.3), edit-flips-to-mine rule.
- **M5 — Source linking.** Magnifying-glass jump-to-transcript (§8.4) + Settings
  screen (§10) + first-run privacy notice + safeStorage for keys.
- **M6 — Package.** `electron-builder` NSIS build that runs on a clean Win 10/11
  machine. (Auto-update out of scope.)

Each milestone must be independently runnable and demoable.

## 13. Post-v1 roadmap (status)

The architecture left room for these; most are now built. Specs live in
`roadmap/v02` and `roadmap/v03` (`ROADMAP_00_INDEX.md` is the map).

- ✅ Calendar auto-start (Google + Microsoft, free/busy only) — ROADMAP_06.
- ✅ Note templates — `roadmap/v02`.
- ✅ Local/offline Whisper transcription (behind the §6.2 interface) — ROADMAP_05.
- ✅ Post-meeting AI chat about a meeting — ROADMAP_07 Phase 1.
- ✅ Cross-meeting / folder querying — ROADMAP_07 Phase 2.
- ✅ Reliability/perf/cost, speaker naming, export + backup — ROADMAP_01/02/04.
- ⏳ Transcript & enhancement quality eval loop — ROADMAP_03 (not yet built).
- ⏳ Accounts + cloud sync + sharing — ROADMAP_04 later phases (not yet built).
- ❌ macOS support (still deferred; architecture should not hard-block it).

## 14. Acceptance criteria for v1 "done"

1. With nothing but mic + speakers, a real Zoom/Teams/Meet call is transcribed live
   with the local user labeled "Me" and remote speakers separated — **no bot ever
   appears in the meeting's participant list.**
2. The user can type notes during the call and they autosave.
3. On stop, audio capture ends and no audio file exists anywhere on disk.
4. Enhanced notes are produced, visually distinguish user vs AI content, and AI
   text edited by the user becomes "user" content.
5. Clicking a source icon jumps to the correct transcript segment.
6. All data persists locally across restarts and is searchable.
7. API keys are stored encrypted, never in plaintext or logs.
8. Runs from a packaged build on a clean Windows 10 and Windows 11 machine.

## 15. Known risks & mitigations

- **Loopback audio reliability** varies with Bluetooth/USB devices and can drop
  out. Mitigation: device picker, "try built-in audio" guidance, reconnect logic
  on the Deepgram socket.
- **Very long meetings** can exceed transcript context limits. Mitigation:
  summarize-then-merge chunking in the enhancer.
- **Mixed system audio** (music/notifications get transcribed). Mitigation:
  document it; not solvable without per-app capture (out of scope).
- **Electron loopback API changes** between versions. Mitigation: pin the Electron
  version; isolate capture in one module so a native-addon fallback can replace it.
