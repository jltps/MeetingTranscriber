# ROADMAP_07 — Cross-Meeting Intelligence

Ask questions of your meetings: chat about one meeting, and query across many. This
is the "second brain" payoff and the most distinctive non-capture feature.

## Why
Once transcripts accumulate, the value shifts from a single meeting's notes to what
emerges across them ("what did we decide about X over the last month?"). Pairs
naturally: single-meeting chat and multi-meeting querying share the same retrieval
machinery.

## Depends on
- Shipped v1 (transcripts + notes persisted, FTS already present).
- Benefits a lot from block 03 (better transcripts and speaker labels → better
  answers). Worth doing 03 first.

## Scope

1. **Single-meeting chat.**
   - A chat panel scoped to one meeting's transcript + notes. Ask follow-ups, get
     summaries, draft follow-up emails, etc.
   - Answers should cite transcript segments the same way enhancement does
     (reuse the source-linking validation from block 03).

2. **Cross-meeting / folder querying.**
   - Query across a set of meetings (all, or a folder/tag) with retrieval over their
     transcripts.
   - Introduce folders/tags if not already present, as the scoping unit.

## Key decisions & caveats
- **Retrieval approach.** FTS (already in the DB) is the cheap start and may be
  enough for single-meeting chat. Cross-meeting querying likely wants embeddings +
  vector search; decide whether to add a local vector store or extend FTS. Keep the
  retrieval layer behind an interface so it can grow.
- **Cost scales with context.** Stuffing many full transcripts into a prompt is
  expensive and hits context limits; retrieve-then-answer rather than dump-all.
  Surface cost (block 01) here too.
- **Grounding.** Answers must be grounded in retrieved segments with citations;
  avoid confident answers the transcripts do not support.
- Language: answer in the user's language / the meetings' language consistently.
- Privacy: this sends more transcript text to the LLM than enhancement does; keep it
  to the cloud Claude call already in use, nothing new.

## Touches
A retrieval layer (FTS and/or embeddings), a chat UI (per-meeting and cross-meeting),
folders/tags in the data model (additive migration), the LLM layer.

## Acceptance
- Per-meeting chat answers questions and cites the right segments.
- A cross-meeting query returns a grounded answer drawing from the correct meetings,
  not hallucinated content.
- Cost per query is visible and bounded by retrieval.

## Out of scope
Agents that take actions. Auto-generated cross-meeting reports (could follow later).
