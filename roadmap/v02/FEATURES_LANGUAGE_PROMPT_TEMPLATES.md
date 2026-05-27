# FEATURES_LANGUAGE_PROMPT_TEMPLATES.md

Three features to add to the **existing** Scribe app (v1 is already built). This is
a focused addendum, not a rebuild. The original `PRODUCT_SPEC.md` describes the
shipped v1; this document supersedes it only for these three features.

Features:
- **A. Multi-language transcription + auto-detect** (must include Portuguese).
- **B. User control over the enhancement prompt.**
- **C. Enhancement templates,** selectable when starting a meeting.

---

## How to approach this (read first)

The app exists and has real data. Before writing code:

1. **Read the current code** for the four areas these features touch: the
   transcription provider, the enhancer, the settings UI, and the DB/migrations
   layer. Match existing patterns — naming, IPC channel style, how settings are
   already stored, how the migration runner works.
2. **Propose the fit before building.** Briefly state where each feature slots into
   the actual structure (which files/modules), then implement. Don't assume the
   layout from the original spec; verify against the repo.
3. **Schema changes are migrations, never recreations** (§D). The DB holds real
   meetings — additive `ALTER TABLE` / new `CREATE TABLE` only.
4. Ship as separate branches/PRs: `feat/language-detect`, `feat/enhancement-prompt`,
   `feat/enhancement-templates`. They're ordered so each builds on the last.

Honor all `CLAUDE.md` §1 invariants throughout — especially #6 (prompt text can't
break the JSON contract) and #7 (never default to English).

---

## A. Multi-language transcription + auto-detect

Today the app is English-only. It must transcribe at least **Portuguese (pt-PT)
and English** as first-class, tested languages, and otherwise **auto-detect**.
There are two independent layers; both must change.

### A1. Transcription layer (Deepgram)

Add a language setting passed into the transcription session:

```ts
type LanguageSetting =
  | { mode: 'auto' }                    // detect; the new default
  | { mode: 'fixed'; bcp47: string };   // 'pt-PT' | 'pt-BR' | 'en-US' | 'es-ES' | …
```

- Extend the existing `TranscriptionSession.start(...)` options to accept the
  resolved `LanguageSetting`, and expose the detected language back to the UI
  (e.g. add `detectedLanguage(): string | null`, returning BCP-47 once known).
- When `mode: 'auto'`, enable Deepgram language detection; otherwise pass the fixed
  `language` param.
- **Verify Deepgram's current model/language matrix at build time** — language
  detection availability depends on the model, and the model must still support our
  existing options (multichannel, diarization, interim results). If the model we
  currently use doesn't support detection alongside those, pick one that does or
  make detection a model-gated capability. Don't silently drop diarization to get
  detection.

**Known limitation — do not try to "fix" it:** Deepgram locks one language per
connection and does not switch mid-stream. A call that **code-switches** (e.g.
Portuguese sprinkled with English product terms — common for this user) will be
transcribed under one dominant language and the other-language stretches will
degrade. Mitigation, not a fix: show the detected language in the UI and let the
user override to a fixed language and re-run. (Native per-language auto-detect is a
v2 reason to add local Whisper behind the same interface.)

### A2. Enhancement output language (easy to miss)

Even with a Portuguese transcript, the LLM will produce **English** notes unless
told otherwise. Output language is its own decision:

- Default the enhanced-notes language to the transcript's **detected** language
  (Portuguese call → Portuguese notes).
- Allow an override from a template (§C) or a global setting (§B).
- Record the language the notes were written in (see `notes.enhanced_lang`, §D).

### A3. Resolution order (when a meeting starts / is enhanced)

1. Template's language, if a template is selected and sets one (§C).
2. Else the global default language from Settings (§B/§E).
3. Else `{ mode: 'auto' }` for transcription and detected-language for output.

### A4. Acceptance
- A Portuguese call transcribes in Portuguese and yields **Portuguese** enhanced
  notes.
- Auto-detect picks the right language for a PT call and an EN call with no manual
  switch.
- The detected language is visible, and a manual fixed-language override exists.
- Existing English behavior is unchanged when language is left at default.

---

## B. User control over the enhancement prompt

Give the user influence over *how* notes are enhanced, at two levels.

### B1. Global custom instructions
A free-text field in Settings, appended to the enhancement prompt for every
meeting. Examples a user might enter: "Always extract action items with an owner
and due date", "Write in European Portuguese", "Terse, executive tone — no
preamble". This is the high-value, low-risk lever; build it first.

### B2. Per-meeting template instructions
Covered by §C; a selected template's instructions take precedence over the global
ones for that meeting.

### B3. Non-negotiable safety rule (CLAUDE.md §1.6)
User-supplied text only ever fills a **custom-instructions slot** inside the
existing prompt. The strict-JSON output contract, the schema, the
my-notes/AI-notes origin rules, and the `sourceSegmentIds` requirement are
**non-editable scaffolding** the user cannot remove or override.

- Assemble the prompt as: fixed scaffolding + `{instructions}` slot + fixed
  output-format rules. Put the user text only in the slot.
- If you ever expose the raw prompt for editing, the scaffolding regions are locked
  (not user-editable).
- After every enhancement, validate against the existing Zod schema and fall back
  to plain markdown on failure. A user instruction must never be able to break
  source-linking.

### B4. Acceptance
- Setting global instructions visibly changes enhanced output across meetings.
- A pathological instruction (e.g. "ignore all formatting and reply in one
  sentence") still yields schema-valid output or a clean markdown fallback —
  source-linking never breaks.

---

## C. Enhancement templates

A **template** is a named, reusable enhancement configuration, selectable when
starting a meeting. (This was a v1 non-goal pulled forward; it's deferrable if
other work is more urgent, but it composes directly with A and B.)

### C1. Shape

```ts
type Template = {
  id: number;
  name: string;                 // "General", "Sales Discovery", "1:1", "Interview"
  instructions: string;         // fills the §B custom-instructions slot
  language?: LanguageSetting;   // optional: forces transcription + output language
  isDefault?: boolean;          // used when starting a meeting without choosing
  isBuiltin?: boolean;          // starter templates the user can duplicate
};
```

### C2. Behavior
- Ship a few **built-in starter templates** (General, Sales Discovery, 1:1,
  Interview) seeded via migration. Built-ins are editable by duplicating; the user
  cannot permanently lose the starters.
- **Selection at meeting start:** add an optional template picker to the existing
  "New Note" / start flow. **"General / no template" stays the one-click default**
  so quick capture is not slowed down — do not force a choice.
- The selected template is recorded on the meeting (`meetings.template_id`, §D) and
  drives both the resolved language (§A3) and the enhancement instructions (§B).
- Template CRUD lives in Settings (§E).
- Deleting a template must **not** break past meetings that used it — null the
  reference, keep the meeting (`ON DELETE SET NULL`).

### C3. Acceptance
- User can create, edit, duplicate, and delete templates; a default exists.
- Starting a meeting with a template applies its instructions (and language, if
  set) to that meeting's enhancement.
- Deleting a referenced template leaves old meetings intact.

---

## D. Schema changes (ADDITIVE MIGRATIONS — the DB has real data)

Write these as new, ordered migration steps in the existing migration runner.
**Do not** edit the original `CREATE TABLE` statements and do not reset the DB.
Column/table names below are indicative — match the existing schema's conventions
(types, naming) discovered by reading the current DB layer.

```sql
-- Migration N: enhancement templates
CREATE TABLE templates (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  instructions  TEXT    NOT NULL DEFAULT '',
  language_mode TEXT,                      -- 'auto' | 'fixed' | NULL (inherit)
  language_code TEXT,                      -- BCP-47 when fixed
  is_default    INTEGER NOT NULL DEFAULT 0,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Migration N+1: link meetings to a template + record their language
-- (SQLite ADD COLUMN is safe/additive; NULL defaults keep existing rows valid.)
ALTER TABLE meetings ADD COLUMN template_id   INTEGER REFERENCES templates(id) ON DELETE SET NULL;
ALTER TABLE meetings ADD COLUMN language_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE meetings ADD COLUMN language_code TEXT;   -- fixed choice, or detected

-- Migration N+2: record the language enhanced notes were written in
ALTER TABLE notes ADD COLUMN enhanced_lang TEXT;

-- Migration N+3: seed built-in starter templates (idempotent — guard on is_builtin)
INSERT INTO templates (name, instructions, is_default, is_builtin, created_at)
SELECT 'General', '', 1, 1, strftime('%s','now')*1000
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE is_builtin = 1);
-- (add Sales Discovery, 1:1, Interview similarly)
```

Notes:
- If the existing `meetings`/`notes` tables already differ from the original spec,
  adapt these `ALTER`s to the real columns. The principle is fixed: additive only.
- Global enhancement instructions and the default language (§B1, §E) are app
  settings — store them wherever settings already live (existing settings store /
  table / safeStorage as appropriate), not necessarily a new column here.
- Add/adjust migration tests against a **copy of a populated DB** to prove old
  meetings survive and remain queryable.

---

## E. Settings additions

Extend the existing Settings screen (match its current structure):
- **Language:** default transcription language with **Auto-detect** as default, plus
  fixed options including pt-PT, pt-BR, en-US, es-ES. Optional separate
  enhanced-notes output language (default: match transcript).
- **Enhancement — global custom instructions:** the §B1 free-text field.
- **Templates:** create / edit / duplicate / delete, set default, optional language
  per template (§C).

---

## F. Interfaces touched (reference)

Adapt to the real signatures in the code; shown for intent.

```ts
// transcription
start(opts: { sampleRate: number; channels: number; language: LanguageSetting }): Promise<void>;
detectedLanguage(): string | null;

// enhancer
enhance(input: {
  userNotes: string;
  transcript: TranscriptSegment[];
  instructions?: string;     // template (§C) or global (§B); fills the slot only
  outputLanguage?: string;   // BCP-47; defaults to detected transcript language
}): Promise<EnhancedNotes>;   // EnhancedNotes also carries `language: string`
```

---

## G. Suggested order

1. **A (language)** — highest user value, touches transcription + enhancer; get
   Portuguese working end to end first.
2. **B (prompt control)** — small, high-value, and establishes the
   instructions-slot pattern that C reuses.
3. **C (templates)** — builds on A and B; the schema work in §D mostly lands here.

Each as its own branch/PR with a migration tested against a populated DB.
