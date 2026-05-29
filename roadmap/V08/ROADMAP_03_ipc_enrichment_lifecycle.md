# ROADMAP_03 — IPC enrichment lifecycle

The highest-risk block: `ipc/transcription.ts` is built assuming `stop()`
tears everything down synchronously. Gladia breaks that — the session must
survive `stop()` until post-processing finishes. Plus the renderer needs to
read insights.

## `scribe/src/main/ipc/transcription.ts`

**Snapshot provider at start.** Alongside `captureMode = getAudioCaptureMode()`
(`:128`), add `let activeProvider = getTranscriptionProvider()` set in
`transcriptionStart`.

**Capture per-session context for the post-stop callback.** Module globals
`meetingId`/`target` are nulled on stop (`:179`), so the `onInsights` closure
must bind locals at start:
```ts
const enrichMeetingId = opts.meetingId;
const enrichTarget = event.sender;
```
Wire `onInsights` into the `createTranscriptionSession({...})` config:
```ts
onInsights: (insights) => {
  // runs AFTER stop, possibly while a new meeting is live — use the captured locals
  void finalizeInsights(enrichMeetingId, enrichTarget, insights, sessionFor(enrichMeetingId));
},
```

**Retention after stop.** Add `const enriching = new Set<TranscriptionSession>()`.
In `transcriptionStop`:
```ts
const stopping = session;            // capture before nulling
const provider = activeProvider;
await stopping?.stop();              // Gladia: stopRecording, keeps socket alive internally
session = null;
if (provider === 'gladia' && stopping) {
  enriching.add(stopping);
  setInsightsProcessing(meetingIdAtStop, 'gladia', /* sessionIds known once started */ []);
  enrichTargetAtStop?.send(IPC.transcriptionInsightsStatus, { meetingId: meetingIdAtStop, status: 'processing' });
}
// ... existing saveDeepgramUsage + clears
```
The session removes itself from `enriching` in `finalizeInsights` (success or
error). `enriching` exists so `disposeTranscription` can drain dangling
sockets; the `GladiaSession` itself holds the strong ref keeping the socket alive.

**`finalizeInsights(meetingId, target, providerInsights, session)`** (new helper):
1. Reconcile "Me"/speaker against persisted segments — **not** the energy
   timeline (cleared at `:181`):
   ```ts
   const segs = getTranscript(meetingId);   // already energy-attributed: channel 0 = "Me"
   ```
   For each insight utterance, find the time-overlapping persisted segment(s);
   adopt majority `channel`/`speakerLabel` → set `isMe`/`speakerLabel`.
   Reconcile each Gladia `speaker` id → a persisted `Speaker N` label by
   majority overlap so the Insights view and live transcript agree.
2. Compute `MeetingInsightsSummary` (speaker talk-time, entity counts, top
   entities, sentiment distribution).
3. `saveInsights(meetingId, normalized, sessionIds)`; push
   `transcriptionInsightsStatus { meetingId, status: 'ready' }` to `target`.
   On throw → `setInsightsError` + push `status: 'error'`. Always
   `enriching.delete(session)`.

**`disposeTranscription` (`:209`, void-ed on `will-quit`):** also drain
`enriching` — call a force-teardown (`endSession`) on each so app close leaves
no dangling sockets/timers. In-flight enrichment is recovered by the
ROADMAP_05 boot-resume path (`session_ids_json` is persisted at `processing`).

**Usage (provider-aware).** `saveDeepgramUsage` (`db/meetings.ts:142`) gains a
`provider` arg and writes `meetings.stt_provider`. ⚠ Handoff produces multiple
sub-sessions but **one** meeting stop — call it **once with the cumulative
total** (`deepgram_channels` is an overwrite, not an add). `audioMs` already
accumulates across the whole session in `transcriptionPushFrame` (`:201-203`),
so this is naturally correct.

**Concurrency.** A new meeting starting mid-enrichment is fine: the new live
session takes over the module `session`; the old Gladia session stays in
`enriching` with its captured `meetingId`/`target`. The renderer treats the
status push as **advisory** and reads authoritatively via `meetingsGetInsights`,
so a backgrounded meeting reopens with correct state.

## `scribe/src/main/ipc/meetings.ts`

Add the handler:
```ts
ipcMain.handle(IPC.meetingsGetInsights, (_e, raw) => getInsights(MeetingIdSchema.parse(raw)));
```

## `scribe/src/preload/index.ts`

- `meetings.getInsights: (id) => ipcRenderer.invoke(IPC.meetingsGetInsights, id)`.
- `onTranscriptionInsightsStatus(cb)`: subscribe to
  `IPC.transcriptionInsightsStatus`, **validate the payload with
  `InsightsStatusSchema`** in the listener (mirror `preload/index.ts:27-29`),
  return an unsubscribe.

## Verification

Live Gladia call: after Stop, confirm `meeting_insights` flips
`processing` → `ready`, the status push fires, and `getInsights` returns
reconciled utterances whose "Me" lines match the live transcript. Start a
second meeting immediately after stopping the first to confirm the captured
`meetingId`/`target` prevent cross-contamination.
