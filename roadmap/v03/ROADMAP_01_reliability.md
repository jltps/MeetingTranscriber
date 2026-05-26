# ROADMAP_01 — Reliability, Performance & Cost

Harden the shipped v1 so it holds up in real, long, important meetings. No new
user-facing feature here; this is the foundation everything else assumes.

## Why first
A dropped transcription socket 40 minutes into a call means permanently lost
transcript, because audio is discarded by design (§1 invariant). That fragility is
the price of no-audio-storage, so the network layer has to earn its keep. Long
meetings also expose UI performance cliffs.

## Depends on
Shipped v1 only.

## Scope

1. **Live transcription resilience.**
   - Detect Deepgram WebSocket drops and auto-reconnect with backoff.
   - Buffer PCM across the gap (in memory only, bounded; never to disk) and flush on
     reconnect so words during the blip are not lost.
   - Surface connection state in the UI (connected / reconnecting / degraded) so the
     user knows if a stretch may be incomplete.
   - On unrecoverable failure, keep the partial transcript and tell the user clearly.

2. **Transcript rendering performance.**
   - Virtualize or append-only render the live transcript; do not re-render the full
     list on every interim result.
   - Verify smooth behavior past the one-hour mark (hundreds to thousands of
     segments).

3. **Cost & usage visibility.**
   - Per-meeting readout: Deepgram audio-minutes (remember it is 2 channels) and
     Claude tokens/approx cost for the enhancement.
   - A simple running total in Settings. This also quantifies the case for local
     Whisper (block 05).

## Key decisions & caveats
- The reconnect buffer is the one place audio lingers slightly longer in memory.
  Keep it bounded and in RAM only; the no-disk rule still holds absolutely.
- Cost figures are estimates; label them as such and keep the pricing constants in
  one place to update when rates change.

## Touches
Transcription layer (reconnect/buffer), transcript UI (virtualization), a small
usage tracker + Settings readout.

## Acceptance
- Pull the network for ~15s mid-meeting: the app reconnects and the transcript has
  no permanent hole for the buffered window.
- A 90-minute meeting scrolls and updates without jank.
- Each meeting shows transcription minutes and enhancement cost.

## Out of scope
Offline transcription (block 05). Persisting audio to survive long outages (never).
