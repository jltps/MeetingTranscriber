# ROADMAP_00_INDEX.md

> **Status: planned.** Three blocks below scoped to ship as a single
> commit to `main` (one logic file + one new test file + one regression
> test). No DB migration, no IPC contract change, no payload-shape
> change.

The **V076 backlog — Bleed-aware mic-priority "Me" attribution.** In
single-mono ("Cost-saver", default) capture mode, the user's own speech
is sometimes mis-classified as a new remote speaker ("Speaker N") even
after "Me" has already been tagged earlier in the meeting. Root cause is
in `scribe/src/main/transcription/me-attribution.ts`: the per-word "Me"
decision (`micDominatedWindow`, called by `attributeWords`) requires
`mic >= sys * 1.5` (V073 baseline, scaled *up* by bleed). With a quiet
user talking over a normal-volume remote, mic RMS is real but doesn't
beat system by 1.5×, so the word flips to not-Me, gets a Deepgram
speaker ID, and is rendered as "Speaker N". The 1-word median filter
only rescues isolated <350 ms slips, so clusters of 2+ make it through.
`groupAttributedWords` / `autoMergeAdjacentSpeakers` can't recover the
misclassification because they treat the per-word `isMe` decision as
ground truth.

The user's intuition is the right north star: when the mic is actively
picking up voice, it's almost certainly "Me". The only counter-case is
**bleed** (laptop-speaker setups where remote audio leaks into the
mic). V073 already quantifies bleed via `computeBleedScore` + the
`captureMode` setting ('auto' / 'headphones' / 'speakers') — we already
know when bleed is a risk and when it isn't. V076 leans on that
signal: at low bleed, drop the strict dominance requirement and trust
the mic floor; at high bleed, keep V073's strict bar. The current
formula scales the *strict* bar by bleed (1.5× → 4.5×); the new formula
**interpolates the bar from 1.0× (no bleed) up to 3.0× (full bleed)**
so the zero-bleed common case becomes lenient by design.

Stereo "Best quality" mode (V075 ROADMAP_04) already tags every
channel-0 word as "Me" by construction (`parse.ts:116-127`), so V076 is
mono-focused — with a small regression test added to pin the stereo
behaviour so future refactors can't silently break it.

§1 invariants hold across every block — no audio on disk (§1.1, energy
timeline is still scalar RMS only), keys stay main-side (§1.2),
renderer stays sandboxed (§1.3), no meeting-platform integrations
(§1.4), user notes sacred (§1.5), strict-JSON enhancer contract
unchanged (§1.6), language auto-detect preserved (§1.7 — V076 doesn't
touch any language-sensitive code).

> **Hold the §1 invariants.** Blocks 01 + 02 are pure-function changes
> inside `me-attribution.ts`; block 03 is tests only. No DB migration,
> no IPC channel, no Settings UI surface, no new dependency.

## The blocks

| # | Block | What it is | Type |
|---|-------|------------|------|
| 01 | Bleed-interpolated dominance | Replace V073's `effDominance = dominance * (1 + 2*bleed)` (1.5× → 4.5×) with `effDominance = 1.0 + (3.0 − 1.0) * bleed` (1.0× → 3.0×). At zero bleed the mic only needs to be present + match sys; at full bleed it must clearly dominate. Mic floor scaling unchanged. | Main transcription |
| 02 | Me-run hysteresis | Once a word is classified Me, subsequent words within ≤ 1.5 s get a 0.7× multiplier on `effDominance`. Prevents brief mic-energy dips between syllables (or behind a remote backchannel) from breaking a coherent Me utterance. Runs before `inheritShortFillerAttribution` and the median filter so V075 ROADMAP_03's invariants hold. | Main transcription |
| 03 | Tests + stereo regression guard | New `me-attribution-mic-priority.test.ts` covering blocks 01 + 02 (zero-bleed lenient, full-bleed strict, hysteresis sticks, hysteresis times out, hysteresis doesn't bridge true remote). Plus a regression test pinning that `parseDeepgramMessage(msg, { singleChannel: false })` with `channel_index=[0]` always emits "Me" — so V075 stereo can't silently regress. | Tests only |

## Dependencies

```
01 bleed-interpolated dominance ──► (no dep) — pure change to
   `micDominatedWindow`. The public MeAttributionOptions shape stays
   the same; `dominance` is preserved as the high-bleed ceiling.

02 me-run hysteresis ──► (consumes 01) — runs the same
   `micDominatedWindow` a second time per non-Me word inside the
   1.5 s window with a relaxed bar. Must run before the V075 ROADMAP_03
   filler-inherit pass + V073 median filter so they see the
   hysteresis-corrected sequence.

03 tests ──► (consumes 01 + 02) — single new test file pins the new
   numeric behaviour. Stereo regression test is independent and could
   land first if 01/02 slip.
```

## Suggested order

1. **01 bleed-interpolated dominance** — the main fix; smallest
   surface (one constant pair, one formula line). Re-tune the
   `tests/me-attribution-bleed.test.ts` numeric expectations as part
   of the same commit (the *shape* of the assertions — dominance rises
   with bleed — holds).
2. **02 me-run hysteresis** — additive polish that compounds well
   with 01. Lands second so test 3 in block 03 can pin it
   independently of the block-01 baseline.
3. **03 tests + stereo regression guard** — ships in the same commit
   as 01 + 02 (the suite needs to stay green at HEAD per CLAUDE.md
   §10/§11). Stereo guard is a one-screen test; mono guards are five
   short cases.

## Cross-cutting notes (hold across every block)

- **No public-API change to `MeAttributionOptions`.** The `dominance`
  option is preserved as the **high-bleed ceiling override** (defaults
  to 3.0 internally; callers can still pass a custom value, which now
  means "the bar at bleed=1"). `windowPadMs`, `micFloor`, `captureMode`
  unchanged.
- **`applyCaptureMode` unchanged.** 'headphones' still forces bleed to
  0 (full lenient regime); 'speakers' still floors bleed at 0.5
  (preserves a strict-ish bar regardless of observed correlation);
  'auto' passes the observed score through.
- **V075 ROADMAP_03 invariant preserved.** Hysteresis runs *before*
  `inheritShortFillerAttribution`, which still runs before
  `medianFilterIsMe`. So fillers still inherit from a coherent
  non-filler run, and the median filter still sees a clean signal.
- **V075 ROADMAP_02 invariant preserved.** `groupAttributedWords`,
  `paragraphBreaks`, `wordSpans`, and `autoMergeAdjacentSpeakers` are
  untouched — the per-word `isMe` they consume just becomes more
  accurate.
- **No DB migration.** `transcript_segments` schema unchanged. No new
  KV setting. No new IPC channel. The Settings → Audio capture-mode
  toggle from V073 remains the only user-facing control.
- **Type/lint/test/build green at every commit** per CLAUDE.md
  §10/§11. Expected suite size: 281 → ~287 tests.

## Cost & quality tradeoff

V076 is **pure logic** — no Deepgram param changes, no new billed
channels, no cost delta. The quality story is asymmetric:

- **Headphones / low-bleed users**: clear quality win. Quiet Me speech
  that V073 flipped to "Speaker N" now correctly tags as Me. Catches
  the most common complaint case.
- **Laptop speakers / high-bleed users**: a small relaxation at
  mid-bleed (~0.5 score → 2.0× bar vs V073's effective 3.0× at the
  same score) that we expect to be in the noise. The 'speakers' mode
  floor still keeps the bar ≥ 2.0×; if field testing shows
  regressions, raise `DOMINANCE_AT_FULL_BLEED` from 3.0 to 4.0 in a
  follow-up commit.

## How to use a block with Claude Code

Same discipline as V073/V075: read the block file plus
`me-attribution.ts` end-to-end before editing, propose how the change
fits the established constants block (lines 39–54) and the V073 bleed
comment block (lines 45–106) before writing, ship as one commit to
`main` (CLAUDE.md §10 + memory `commit-to-main`), hold the §1
invariants, keep `corepack pnpm typecheck/lint/test/build` green. The
diarization-quality win is only visible live — a `corepack pnpm dev`
run with quiet Me speech over a normal-volume remote is the real
verification (see block 01 verification section).
