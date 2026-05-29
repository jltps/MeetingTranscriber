# ROADMAP_01 — Bleed-interpolated dominance threshold

## Context

V073 ROADMAP_02 introduced bleed-aware "Me" classification: the
dominance bar `mic / sys` scales *up* with the rolling mic/system
cross-correlation score, on the theory that high correlation means the
mic is hearing the system audio (laptop speakers) and we should
require stricter dominance to call it Me. The implementation in
`scribe/src/main/transcription/me-attribution.ts:160`:

```ts
const effDominance = dominance * (1 + BLEED_GAIN * bleed);
// dominance = 1.5, BLEED_GAIN = 2.0
// bleed=0   → 1.5×
// bleed=0.3 → 2.4×
// bleed=0.5 → 3.0×
// bleed=1.0 → 4.5×
```

The flaw: the **baseline** is 1.5×, which is too strict for the
common case (headphones, no bleed). A user speaking at normal volume
over a normal-volume remote routinely has `mic / sys ≈ 1.0–1.4`. V073
flips those words to not-Me, gets a Deepgram speaker ID, and renders
"Speaker N" — even after Me has been correctly tagged earlier in the
meeting. The 1-word median filter only rescues isolated <350 ms slips;
2-3 word clusters slip through. The downstream
`groupAttributedWords` + `autoMergeAdjacentSpeakers` can't recover
because they treat the per-word `isMe` decision as ground truth.

The user's intuition is the right north star: when the mic is actively
picking up voice, it's almost certainly Me. Bleed is the only real
counter-case, and V073 already quantifies bleed independently. V076
ROADMAP_01 re-orients the formula so that the bar **interpolates from
1.0× (no bleed) up to 3.0× (full bleed)** instead of starting at 1.5×
and scaling up to 4.5×. Zero bleed becomes lenient by design; high
bleed remains strict.

## What changed

### `scribe/src/main/transcription/me-attribution.ts`

- Replace `BLEED_GAIN = 2.0` (line 50) with the new constant pair:

  ```ts
  /** V076 — dominance ratio applied when bleed score is 0
   * (headphones / no leak). Mic just needs to match sys, not
   * dominate it. Combined with `micFloor`, this catches normal-
   * volume Me speech that V073's 1.5× baseline flipped to
   * "Speaker N". */
  const DOMINANCE_AT_ZERO_BLEED = 1.0;

  /** V076 — dominance ratio applied when bleed score is 1
   * (constant mic/sys co-variation, laptop-speaker worst case).
   * The high-bleed cap; mic must clearly dominate. Slightly
   * stricter than V073's bleed=0.5 case (3.0×) and *less* strict
   * than V073's full-bleed extreme (4.5× — over-strict in
   * practice). Override per-call via `MeAttributionOptions.dominance`. */
  const DOMINANCE_AT_FULL_BLEED_DEFAULT = 3.0;
  ```

- Change `DEFAULTS` (lines 39–43) so `dominance` defaults to the new
  full-bleed cap (`3.0`) rather than the old 1.5 baseline. The
  semantics of the option flip: it now means "dominance at full
  bleed", not "dominance at zero bleed". Callers passing a custom
  value (none today inside the repo — verify with a Grep — but the
  shape is preserved for external compatibility) get the new
  semantics.

  ```ts
  const DEFAULTS: Required<Omit<MeAttributionOptions, 'captureMode'>> = {
    windowPadMs: 150,
    micFloor: 0.01,
    dominance: DOMINANCE_AT_FULL_BLEED_DEFAULT,
  };
  ```

- Update the JSDoc on `MeAttributionOptions.dominance` (lines 29–30):
  > "Mic-vs-system ratio required to call a word Me at full bleed.
  > Linearly interpolated from `DOMINANCE_AT_ZERO_BLEED` (1.0) at
  > bleed=0 up to this value at bleed=1."

- Rewrite the body of `micDominatedWindow` lines 154–162 to do the
  interpolation:

  ```ts
  const bleed = applyCaptureMode(
    computeBleedScore(timeline, endMs),
    options.captureMode,
  );
  // V076: interpolate the dominance bar from a lenient floor at
  // zero bleed up to the strict ceiling at full bleed. V073's
  // formula scaled the strict bar *up* with bleed; the zero-bleed
  // baseline (1.5×) was over-strict for the common headphones case.
  const effDominance =
    DOMINANCE_AT_ZERO_BLEED +
    (dominance - DOMINANCE_AT_ZERO_BLEED) * bleed;
  const effFloor = micFloor * (1 + BLEED_FLOOR_GAIN * bleed);
  return mic >= effFloor && mic >= sys * effDominance;
  ```

- Remove the now-unused `BLEED_GAIN` constant. Keep `BLEED_FLOOR_GAIN`
  unchanged — the mic floor still scales with bleed (noisy environments
  need a higher floor to filter ambient).

- Update the V073 block-comment at lines 13–19 + the doc-comment at
  lines 124–131 to describe the new interpolation semantics.

### `scribe/tests/me-attribution-bleed.test.ts`

The "Bleed-aware dominance" cases (lines 63–84) gate on specific
numeric thresholds derived from V073's formula. The *shape* of the
assertions — dominance rises with bleed, mic-clear-dominance wins,
mic-marginal loses at high bleed — holds. Re-derive the inputs so the
expected outcomes match the new formula:

| Bleed | V073 bar | V076 bar |
|------:|---------:|---------:|
| 0.0   | 1.5×     | 1.0×     |
| 0.3   | 2.4×     | 1.6×     |
| 0.5   | 3.0×     | 2.0×     |
| 1.0   | 4.5×     | 3.0×     |

Specifically, the test that asserts a `mic=0.05, sys=0.04` window is
NOT Me under high bleed should keep that assertion (0.05 < 0.04 * 3.0
= 0.12, still not Me). A *new* assertion in V076 ROADMAP_03 will pin
that the *same window* IS Me under zero bleed (0.05 >= 0.04 * 1.0 +
floor satisfied).

The `applyCaptureMode` overrides test (lines 87–111) is unaffected
— it tests the bleed-clamp, not the dominance formula.

The median-filter test (lines 113–136) is unaffected.

## Files changed

- `scribe/src/main/transcription/me-attribution.ts` — constants,
  `DEFAULTS`, `micDominatedWindow` body, two doc-comments.
- `scribe/tests/me-attribution-bleed.test.ts` — re-derive the
  expected numbers in the bleed-aware dominance cases.

## Verification

- `corepack pnpm test` — full suite green; `me-attribution-bleed`
  passes with re-derived numbers.
- `corepack pnpm typecheck` + `corepack pnpm lint` — clean.
- **Manual mono headphones**:
  1. `corepack pnpm dev`, start a meeting.
  2. Speak at normal volume over a remote speaker who is also at
     normal volume (real conference call works fine; a YouTube video
     in the system mix is a cheap proxy).
  3. Confirm your speech tags as "Me" throughout. Under V073, words
     where your mic/sys ratio was ~1.0–1.4 would have shown as
     "Speaker N"; under V076 they should consistently show "Me".
  4. Confirm the remote speaker's solo segments still tag as their
     own "Speaker N" (i.e. we didn't break the not-Me side).
- **Manual mono laptop speakers** (set Settings → Audio → Capture
  mode to 'speakers'):
  1. Same meeting, but with laptop speakers playing the remote.
  2. The 'speakers' clamp keeps bleed ≥ 0.5, so the effective bar
     is ≥ 2.0×. Confirm the remote speaker is *not* mis-attributed
     to "Me" even though laptop-speaker bleed pumps mic RMS.
  3. If field testing shows regressions here, raise
     `DOMINANCE_AT_FULL_BLEED_DEFAULT` from 3.0 to 4.0 in a
     follow-up — the change is one constant.

§1 invariants: pure-function change inside the heuristics layer. No
audio bytes (timeline still scalar RMS), no new keys, no JSON-contract
change, no migration, no IPC.
