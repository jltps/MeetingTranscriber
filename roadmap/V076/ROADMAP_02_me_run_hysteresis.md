# ROADMAP_02 — Me-run hysteresis

## Context

V076 ROADMAP_01 widens the lenient regime so most quiet Me speech now
classifies correctly. The remaining failure mode is **brief mic-energy
dips inside an otherwise coherent Me utterance**: between syllables,
behind a short remote backchannel ("yeah", "right"), or during a deep
breath, the per-word energy window samples briefly drop below the
dominance bar and the word flips to not-Me. Even a single
misclassified word ruins the segment: `groupAttributedWords` partitions
on `isMe` as the primary key, so one not-Me word in the middle of a Me
run splits the run into three segments (Me / Speaker N / Me) and the
auto-merge pass cannot fix it (it only merges adjacent *remote*
fragments, channel 1 only).

V073's 1-word median filter rescues *isolated* short flips with both
neighbours agreeing — it doesn't help when the dip lasts 2+ words or
when both neighbours are also under the dominance bar momentarily.

V076 ROADMAP_02 adds **run hysteresis**: once we have evidence the
user is talking, we require stronger counter-evidence to switch. For
1.5 s after each Me word, the next word's dominance bar is multiplied
by 0.7×. Mic-floor and bleed-floor scaling are unchanged — silence
still wins, and a true loud remote run (sys ≫ mic, mic < floor) still
flips off Me cleanly.

This is a property of the word *sequence*, not the energy window, so
it lives inside `attributeWords` (not inside `micDominatedWindow`).

## What changed

### `scribe/src/main/transcription/me-attribution.ts`

- Add two constants alongside the V073 / V076 block (after the
  `PER_WORD_WINDOW_PAD_MS` constant at line 192):

  ```ts
  /** V076 ROADMAP_02 — time window (ms) after a Me word during
   * which the next non-Me word gets a relaxed dominance bar.
   * 1.5 s comfortably spans inter-syllable gaps and short remote
   * backchannels without bridging a real speaker change. */
  const HYSTERESIS_WINDOW_MS = 1500;

  /** V076 ROADMAP_02 — multiplier applied to the dominance bar
   * during the hysteresis window. 0.7 ≈ "30 % more lenient";
   * combined with the V076 ROADMAP_01 zero-bleed bar (1.0×) the
   * relaxed bar is 0.7× — mic must still be at least 70 % of sys
   * to flip back to Me. Mic floor unchanged. */
  const HYSTERESIS_DOMINANCE_FACTOR = 0.7;
  ```

- Rewrite `attributeWords` (lines 203–223) to run a hysteresis pass
  between the first-pass classification and the
  `inheritShortFillerAttribution` / `medianFilterIsMe` calls:

  ```ts
  export function attributeWords(
    words: readonly DeepgramWordView[],
    timeline: readonly EnergySample[],
    options: MeAttributionOptions = {},
  ): AttributedWord[] {
    const effective: MeAttributionOptions = {
      windowPadMs: PER_WORD_WINDOW_PAD_MS,
      ...options,
    };
    const attributed: AttributedWord[] = words.map((w) => ({
      ...w,
      isMe: micDominatedWindow(timeline, w.startMs, w.endMs, effective),
    }));
    // V076 ROADMAP_02 — Me-run hysteresis. Once a word is Me, the
    // next ≤ HYSTERESIS_WINDOW_MS of words get a relaxed bar so
    // brief mic-energy dips don't fracture a coherent Me run.
    // Mutates `attributed` in place; runs before filler-inherit +
    // median filter so those passes see a clean sequence.
    applyMeRunHysteresis(attributed, timeline, effective);
    inheritShortFillerAttribution(attributed);
    return medianFilterIsMe(attributed);
  }

  function applyMeRunHysteresis(
    words: AttributedWord[],
    timeline: readonly EnergySample[],
    effective: MeAttributionOptions,
  ): void {
    const baseDominance = effective.dominance ?? DEFAULTS.dominance;
    let lastMeEndMs = -Infinity;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.isMe) {
        lastMeEndMs = w.endMs;
        continue;
      }
      if (w.startMs - lastMeEndMs > HYSTERESIS_WINDOW_MS) continue;
      const relaxed = micDominatedWindow(timeline, w.startMs, w.endMs, {
        ...effective,
        dominance: baseDominance * HYSTERESIS_DOMINANCE_FACTOR,
      });
      if (relaxed) {
        words[i] = { ...w, isMe: true };
        lastMeEndMs = w.endMs;
      }
    }
  }
  ```

- The hysteresis pass runs **before** `inheritShortFillerAttribution`
  so the filler-inherit donor (the nearest non-filler) sees the
  hysteresis-corrected `isMe`. V075 ROADMAP_03's invariant — fillers
  inherit from a coherent non-filler run — is preserved.
- The pass runs **before** `medianFilterIsMe` so the median filter
  still operates on the final per-word decision. Cases where
  hysteresis re-classifies a word back to Me are no longer single-word
  disagreements, so the median filter naturally leaves them alone.
- The `lastMeEndMs` cursor updates when hysteresis flips a word back
  to Me, so consecutive marginal words can all be rescued from one
  initial Me anchor — but only if each is within 1.5 s of the
  *previous* Me word. A true 2-second remote run still breaks the
  chain (the cursor goes stale).

### Why hysteresis can't bridge true remote speech

The relaxed bar is `0.7× × baseDominance`, which at zero bleed is
`0.7×` — mic must still be at least 70 % of sys to flip back. A genuine
remote-only run has mic ≈ silence (mic < `micFloor` after bleed
scaling), and the floor check `mic >= effFloor` short-circuits to
`false` regardless of the dominance bar. So:

- Brief mic-energy dip inside a Me run (mic ≈ 0.6× sys, still above
  floor) → relaxed bar 0.7× catches it, flips to Me. ✓
- True remote-only run (mic ≈ 0 after bleed scaling, well below
  floor) → floor check fails, word stays not-Me, cursor goes stale
  after 1.5 s. ✓
- Remote with constant low mic-pickup bleed (mic above floor but well
  below sys) → bleed score rises in the timeline, the strict bar
  rises with it (V076 ROADMAP_01), even the relaxed bar stays above
  the observed `mic/sys` ratio. ✓

## Files changed

- `scribe/src/main/transcription/me-attribution.ts` — two new
  constants, one rewritten function (`attributeWords`), one new
  helper (`applyMeRunHysteresis`).

## Verification

- `corepack pnpm test` — full suite green. Block 03's tests 3 / 4 / 5
  exercise the hysteresis behaviour directly.
- `corepack pnpm typecheck` + `corepack pnpm lint` — clean.
- **Manual mono headphones**:
  1. `corepack pnpm dev`, start a meeting.
  2. Speak a 5–10 second sentence with deliberate small pauses
     between words. Under V073 + V076 ROADMAP_01 alone, the pauses
     could still scatter 1–2 words into "Speaker N"; under V076
     ROADMAP_01 + 02 the entire sentence should stay one "Me"
     segment.
  3. Then go silent for >2 s while the remote talks. Confirm the
     remote's words tag as "Speaker N" (cursor goes stale, hysteresis
     does not bridge).
  4. Then speak over a remote backchannel ("yeah" / "right" in the
     middle of your sentence). Confirm your sentence still tags as
     one "Me" segment.

§1 invariants: pure-function pass on the in-memory word array;
energy timeline is still scalar RMS only; no new keys, no JSON
contract change, no migration, no IPC.
