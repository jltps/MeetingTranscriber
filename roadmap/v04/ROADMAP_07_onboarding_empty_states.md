# ROADMAP_07 — Onboarding & Empty States

Make the first five minutes good, and make every empty screen helpful. Today a new user
lands on a bare two-pane layout, the privacy notice is a single gate, and empty surfaces
read as terse strings ("Select a meeting or create a new note.", "No meetings yet."). A
user who hasn't entered API keys gets failures rather than guidance. This block adds a
**first-run onboarding flow**, polished **empty states** everywhere, and a guided
**connect-keys flow**.

## Why
The app is privacy-first and key-dependent — the moment that needs the most hand-holding
is exactly the one that's roughest today. Good empties also turn dead ends (no meetings,
no folders, empty search) into next actions.

## Depends on
**01** (tokens) + **02** (shadcn `Dialog`/stepper, lucide). Light dependency on **04**
(folder empty state). Reuses the existing `PrivacyNotice` and the existing keys path.

## Scope

1. **First-run onboarding.**
   - New `renderer/features/onboarding/OnboardingFlow.tsx`: a short multi-step flow —
     welcome → privacy → connect keys → ready. Gated on a persisted `onboarding_done`
     flag (`use-onboarding.ts`, first-run detection from settings).
   - Integrate the existing `PrivacyNotice` as the privacy step (don't fork it); the
     keys step calls `settings.setKeys` + `settings.test`.

2. **Empty states.**
   - New reusable `renderer/components/EmptyState.tsx` (icon + title + hint + CTA). Apply
     to: no meetings (sidebar), no meeting selected (center), no transcript yet, empty
     chat, empty cross-chat, no folders, empty search.

3. **Connect-keys flow.**
   - Reachable from onboarding and from any empty/error surface that needs a key. A
     "Connect keys" CTA deep-links to the keys step / Settings keys section.

## Key decisions & caveats
- **§1.2 is the load-bearing constraint.** The connect-keys flow **reuses the existing
  `settings.setKeys` → main `safeStorage` path**. API keys never live in renderer state
  beyond the input field and are never logged. Do not build a second key-handling path.
- **Privacy gate stays.** Onboarding wraps the existing `PrivacyNotice` behavior; it must
  still gate capture exactly as today — don't weaken it.
- **Wipe re-triggers onboarding.** Clearing `onboarding_done` on wipe means a true reset
  shows the first-run flow again (desirable).
- Empty states must be theme-correct and AA in both themes (verified in block 08).
- Don't block the whole app behind onboarding in a way that conflicts with the existing
  privacy-acceptance flow.

## Touches
New `renderer/features/onboarding/OnboardingFlow.tsx` + `use-onboarding.ts`, new
`renderer/components/EmptyState.tsx`, `renderer/app/App.tsx` (render onboarding when
`!onboarding_done`; replace the center placeholder), `renderer/features/meetings/
MeetingSidebar.tsx`, `renderer/features/chat/ChatPanel.tsx` + `CrossChatView.tsx`,
`renderer/features/transcript/TranscriptPanel.tsx`, `renderer/features/settings/
SettingsModal.tsx` (keys CTA), `main/db/settings.ts` (`onboarding_done` getter/setter +
reset on wipe), `shared/ipc-contract.ts` (`onboardingDone` added to `SettingsView`).

## IPC to add
None new — reuses `settings.setKeys` / `settings.test` / `settings.acceptPrivacy`. Adds
`onboardingDone` to the `SettingsView` shape (additive).

Migration: none.

## Acceptance
- A fresh install (or post-wipe) shows onboarding: welcome → privacy → connect keys →
  done, and persists completion.
- Keys entered in onboarding are stored encrypted in main (never in renderer/logs) and
  are testable from the flow.
- Every empty surface (sidebar, editor, chat, cross-chat, transcript, folders, search)
  has a polished, actionable empty state.
- Both themes; `pnpm typecheck/lint/test/build` green.

## Out of scope
Interactive product tours/coachmarks, sample/demo data seeding, and account creation
(there are no accounts — ROADMAP_04 later phases remain deferred).
