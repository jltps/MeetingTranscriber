# ROADMAP_00_INDEX.md

The post-v1 backlog for Scribe, split into independent building blocks. Each block
has its own file and can be specced into Claude Code on its own. This index
explains the grouping, what depends on what, and a suggested order.

**Currently in progress (not in this backlog):** multi-language + auto-detect,
enhancement prompt control, and templates. See
`FEATURES_LANGUAGE_PROMPT_TEMPLATES.md`.

All blocks inherit the `CLAUDE.md` §1 invariants. Two recur here and are easy to
break: **no audio is ever stored**, and the **transcription/enhancer interfaces
stay swappable**. Several blocks below exist only because those interfaces were
kept clean.

## The blocks

| # | Block | What it is | Type |
|---|---|---|---|
| 01 | Reliability, Performance & Cost | Harden shipped v1: reconnect, render perf, usage/cost readout | Hardening |
| 02 | Speaker Naming | Put real names on speakers; merge/reassign mislabels | Feature |
| 03 | Transcript & Enhancement Quality | Make the core output genuinely good: eval loop, source-link accuracy | Quality |
| 04 | Data: Export, Backup, Sync & Sharing | Where data lives and who can reach it, in phases | Feature (phased) |
| 05 | Local / Offline Transcription (Whisper) | Private, $0, better code-switching, behind the existing interface | Feature |
| 06 | Calendar Integration (Google + Microsoft/Teams) | Auto-start at scheduled time; read-only calendar, app never joins the call | Feature |
| 07 | Cross-Meeting Intelligence | Chat about a meeting; query across many meetings | Feature |

## Dependencies

```
v1 (shipped) ── 01 Reliability ─────────────► (everything is steadier on this)
             ├─ 02 Speaker Naming ───────────► names flow into notes, export, 07
             ├─ 03 Quality ─────────────────► feeds 07 (better transcripts → better retrieval)
             ├─ 04 Data (export→backup→sync→sharing)
             │        └─ sync/sharing phase needs accounts; export/backup do not
             ├─ 05 Whisper ── motivated by 01's cost readout; native auto-detect helps language work
             ├─ 06 Calendar (Google + MS/Teams) ── standalone; later feeds name suggestions into 02
             └─ 07 Cross-meeting ── benefits from 02 + 03; shares retrieval infra (embeddings/FTS)
```

## Suggested order

1. **01 Reliability** first. A dropped socket mid-call loses transcript permanently
   (audio was discarded by design). Everything else assumes capture is dependable.
2. **02 Speaker Naming** early. One of the first things a user wants, small to build,
   and the names improve notes, export, and cross-meeting answers later.
3. **03 Quality** next. "AI fleshes out my notes well" is the product. Cheap to
   start (an eval loop), high leverage, and it improves block 07 later.
4. **04 Data: export + backup** early too (small, and it is your only backup/sharing
   story until sync exists). Defer the sync/sharing phases until you actually want
   multi-device or collaboration.
5. Then pick by need: **05 Whisper** if cost/privacy bite, **06 Calendar**
   (Google + Microsoft/Teams) for convenience, **07 Cross-meeting** for the "second
   brain" payoff.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as the active features:
read the existing code, propose the fit before writing, ship as its own branch,
migrations only against the populated DB, hold the §1 invariants.
