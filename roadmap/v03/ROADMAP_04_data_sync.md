# ROADMAP_04 — Data: Export, Backup, Sync & Sharing

One concern at four levels of ambition: where the data lives and who can reach it.
Do it in phases. The first two are small and standalone; the last two are a real
architectural shift and need accounts.

## Why
Today everything is one local SQLite file: a single point of failure, no backup, no
way to share a meeting. Export and backup fix the urgent gaps cheaply. Sync and
sharing are the larger v-next ambition.

## Depends on
- Phases 1 & 2: shipped v1 only.
- Phases 3 & 4: phase 1 (a clean serialization of a meeting) and accounts.

## Phases

### Phase 1 — Export a meeting
- Export a single meeting to **Markdown** (enhanced notes + transcript + metadata,
  in the meeting's language). Optionally also a plain transcript .txt.
- Doubles as the interim sharing mechanism: the user can paste/send the file.
- Smallest useful unit; build first.

### Phase 2 — Backup & restore
- One-click export of all data (the DB, or a bundle of per-meeting Markdown/JSON)
  to a user-chosen folder, and a restore path.
- No audio, ever. This is the backup story until sync exists.

### Phase 3 — Accounts & cloud sync
- Introduce accounts/auth and sync meetings + notes + transcripts across devices.
- This is the big shift: it changes the app from local-only to client+server, adds
  conflict handling, and reopens privacy posture decisions.
- Still no audio leaves the device beyond the existing transcription call.

### Phase 4 — Sharing & collaboration
- Share a meeting (read-only first), then optional comments/co-editing.
- Builds on accounts + sync.

## Key decisions & caveats
- Pick a serialization format in phase 1 that phases 3/4 can reuse, so sync is not a
  rewrite.
- Sync/sharing are where "local-first, single-user, no accounts" (a v1 stance) is
  deliberately reversed. Treat that as a product decision, not a default; confirm
  before starting phase 3.
- Keep `safeStorage`-protected keys out of any export/backup bundle.

## Touches
- P1/P2: a serializer + file IO in main, a small Settings/export UI.
- P3/P4: auth, a sync service/protocol, server-side storage, conflict resolution,
  a sharing/permissions model.

## Acceptance
- P1: a meeting exports to faithful Markdown in the right language.
- P2: full backup and restore round-trips with no data loss and no audio.
- P3: a meeting created on one device appears on another.
- P4: a shared meeting is viewable by an invited account, owner controls access.

## Out of scope (until explicitly chosen)
Real-time multi-user editing beyond basic collaboration; public publish links.
