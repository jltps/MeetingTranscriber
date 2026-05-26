# ROADMAP_03 — Transcript & Enhancement Quality

Make the core output genuinely good. The whole value proposition is "AI fleshes out
my rough notes well," and that is the least de-risked part of the product. This is
mostly iteration discipline plus one correctness feature.

(Speaker naming, which also lifts perceived quality, is its own block 02 — do that
first.)

## Why early
High leverage, cheap to start, and it compounds: better transcripts and better
enhancement also make cross-meeting intelligence (block 07) work.

## Depends on
Shipped v1 (enhancer + transcript). Independent of everything else.

## Scope

1. **Enhancement prompt eval loop.**
   - Keep a small fixture set of real transcript + user-notes pairs (messy,
     multi-speaker, multi-language), stored outside the app (a dev-only folder, no
     audio).
   - A script that runs the current prompt against all fixtures and shows the
     enhanced output side by side, so a prompt change can be judged as better or
     worse rather than guessed at.
   - Run it on every change to `prompt.ts`. This is a dev tool, not a shipped
     feature.

2. **Source-link accuracy.**
   - Validate every `sourceSegmentId` the model returns actually exists; drop the
     source icon rather than link to a nonexistent or wrong segment.
   - Optionally have the model also return a short anchor phrase per cited segment;
     verify it against the segment text and discard citations that do not match.
   - Goal: a wrong jump is worse than no jump.

## Key decisions & caveats
- Fixtures are dev-only and must never contain audio; transcript text + notes only.
- Source-link validation must run before render every time, including on the
  markdown fallback path.

## Touches
Enhancer (prompt, output validation), a dev eval script.

## Acceptance
- Changing the prompt produces a visible before/after across the fixture set.
- No source icon ever jumps to a wrong or missing segment.

## Out of scope
Speaker naming (block 02). Cross-meeting retrieval (block 07).
