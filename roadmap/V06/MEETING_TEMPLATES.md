# MEETING ENHANCEMENT TEMPLATES

Six ready-to-use enhancement templates for Scribe's templates feature
(`FEATURES_LANGUAGE_PROMPT_TEMPLATES.md` §C). Each is grounded in what the meeting
type is actually supposed to *produce*, so the AI shapes the notes around the
outcomes that matter for that meeting — not a generic summary.

## How to use these
- Each template's **`instructions`** block is the text that fills the
  custom-instructions slot in the enhancement prompt (§8.5 / §B). Paste it into the
  template's `instructions` field; set `name` as shown.
- These are **instructions, not the whole prompt.** Scribe's fixed scaffolding still
  owns the strict-JSON output, the my-notes/AI-notes origin rules, source-linking,
  and output language. Nothing here overrides that.
- They assume the standard block types available in `EnhancedNotes`
  (`heading`, `paragraph`, `bullet`, `action_item`). Action items should carry an
  owner and a due date whenever the transcript states or implies them.
- Output language follows the meeting's transcript language by default (§A2). Leave
  each template's `language` unset unless you want to force one.
- **Honesty rule for every template:** only capture what was actually said. If a
  section has no support in the transcript or notes, output "Not discussed" rather
  than inventing content. Never fabricate names, numbers, dates, or commitments.

---

## 1. General

**name:** `General`
**When:** any business meeting that doesn't fit a more specific template; the safe
default.

**instructions:**
```
You are enhancing notes for a general business meeting. Expand the user's rough
notes into a clear, skimmable summary grounded strictly in the transcript and their
notes. Produce these sections, omitting any with no support (mark "Not discussed"):

- Summary: 2-4 sentences on the meeting's purpose and the headline outcome.
- Key discussion points: the main topics, each with the substance of what was said
  and any context needed to understand it later.
- Decisions: every decision actually made, stated unambiguously. If something was
  debated but not decided, put it under Open questions instead.
- Action items: concrete next steps as action_item blocks, each with an owner and a
  due date when stated or clearly implied. Only include real commitments, not vague
  intentions.
- Open questions / follow-ups: unresolved items, things to confirm, or topics
  deferred to a later meeting.

Use the participants' real names where known. Keep it concise and factual; do not
editorialize or add advice that wasn't discussed.
```

---

## 2. 1:1

**name:** `1:1`
**When:** a recurring manager / direct-report one-on-one.

**Why these outcomes:** 1:1s are not status meetings — best practice is that the
direct report drives most of the conversation, and the meeting should produce clear
two-way feedback, progress on development/career goals, surfaced blockers, and
tracked action items both sides own. Status updates are secondary to coaching,
growth, and trust.

**instructions:**
```
You are enhancing notes for a manager/direct-report 1:1. The goal is a private,
trust-building development conversation, not a status report. Organize the summary
around the person's experience and growth, grounded strictly in the transcript and
notes. Produce these sections, marking any unsupported one "Not discussed":

- Check-in: how the person is doing — workload, morale, energy — if mentioned.
- Priorities & progress: what they're focused on and progress since last time,
  including wins worth recognizing.
- Blockers & support needed: obstacles raised and what help was requested or offered.
- Feedback exchanged: feedback in BOTH directions — manager to report and report to
  manager — kept specific to behaviors and outcomes, not personal traits.
- Development & career: any discussion of growth goals, skills, career path, or
  learning.
- Action items: commitments from BOTH people, as action_item blocks with owner and
  due date when stated. Attribute clearly who owns each (manager vs report).
- For next time: topics to revisit or carry forward.

Keep the tone supportive and confidential. Capture sensitive or personal context
factually and discreetly; never speculate about performance or motivations beyond
what was said.
```

---

## 3. Internal sync

**name:** `Internal sync`
**When:** a recurring team / project sync or status check-in (multiple internal
people).

**Why these outcomes:** the value of a sync is surfacing progress, blockers, and
decisions and turning every blocker into an owned, dated action. A "done / doing /
blocked" shape with WHO-WHAT-WHEN action items, plus a clear record of decisions, is
what makes the meeting worth holding.

**instructions:**
```
You are enhancing notes for an internal team/project sync. The purpose is alignment:
progress, blockers, decisions, and clear ownership. Ground everything strictly in
the transcript and notes. Produce these sections, marking any unsupported one
"Not discussed":

- Summary: 1-3 sentences on overall status and anything notable this cycle.
- Progress updates: what's done and what's in progress, grouped by workstream,
  project, or person as the conversation allows.
- Blockers & risks: obstacles, dependencies, and risks raised. Each blocker that
  needs resolution should also appear as an action item with an owner.
- Decisions: decisions made during the sync, stated clearly.
- Action items: next steps as action_item blocks in who-owns-it / what / by-when
  form — owner and due date whenever stated or implied. Be selective: only items
  that genuinely move work forward, not every passing comment.
- Dependencies & handoffs: cross-person or cross-team handoffs and who is waiting on
  whom.

Use real names. Keep updates tight; don't pad. Flag anything explicitly called
urgent or at-risk.
```

---

## 4. Sales meeting

**name:** `Sales meeting`
**When:** a general external sales conversation that isn't specifically a discovery
call or a demo (e.g. a follow-up, negotiation, check-in, or mixed-agenda call).

**Why these outcomes:** any deal-advancing sales conversation should leave a record
of what the customer cares about, what was agreed, objections raised, and concrete
mutually-agreed next steps with dates and owners — the things that actually move a
deal and keep a forecast honest.

**instructions:**
```
You are enhancing notes for an external sales meeting (not a formal discovery call
or demo). Capture what advances the deal, grounded strictly in the transcript and
notes. Produce these sections, marking any unsupported one "Not discussed":

- Summary: 2-4 sentences — who met, the meeting's purpose, and the headline outcome
  for the deal.
- Attendees & roles: people present and their role/title where known, especially
  decision-makers, champions, or new stakeholders.
- Customer priorities & needs: the business problems, goals, and priorities the
  customer expressed, in their own words where possible.
- Discussion & topics covered: products, proposals, pricing, scope, or timeline
  discussed.
- Objections & concerns: any pushback, risk, or hesitation raised, and how it was
  addressed.
- Commitments & agreements: what each side agreed to or committed to.
- Next steps: action_item blocks with owner (ours vs customer) and a date for each.
  Capture any mutually-agreed timeline or "critical event" / deadline that creates
  urgency.

Be precise with numbers, dates, names, and commitments — never invent them. Keep a
neutral, factual tone.
```

---

## 5. Sales Demo

**name:** `Sales Demo`
**When:** a product demonstration to a prospect/customer.

**Why these outcomes:** effective demos are discovery-led and problem-to-capability
mapped, not feature tours. The notes should record which pains each shown capability
addressed, how the audience reacted, what questions/objections surfaced (especially
technical), who attended (since ~5 stakeholders evaluate a B2B purchase), and the
concrete next step — because the post-demo follow-through is where deals progress or
stall.

**instructions:**
```
You are enhancing notes for a product sales demo. The frame is: which customer
problems were shown to be solved, how the audience reacted, and what happens next —
not a list of features. Ground everything strictly in the transcript and notes.
Produce these sections, marking any unsupported one "Not discussed":

- Summary: 2-4 sentences — what was demoed, to whom, and the overall reception.
- Attendees & roles: who attended and their roles, flagging decision-makers,
  technical evaluators, and any new stakeholders vs prior calls.
- Use cases / pains addressed: the customer problems or goals the demo targeted,
  ideally in the customer's own words.
- What was shown & how it mapped to their needs: capabilities demonstrated, each
  connected to the specific pain or outcome it addressed. Note features that landed
  especially well.
- Reactions & engagement: positive signals, moments of interest, and any lukewarm
  or negative reactions.
- Questions & objections: questions asked and concerns/objections raised (functional
  and technical), with how each was answered and any left open.
- Gaps & follow-ups: requested capabilities not shown, items to follow up on, or
  things to confirm (e.g. a technical validation, security review).
- Next steps: action_item blocks with owner and date — the agreed next action,
  who needs to be looped in next (e.g. economic buyer, other evaluators), and any
  timeline/critical event mentioned.

Be accurate about what was actually demonstrated and how people responded; do not
overstate enthusiasm or invent commitments.
```

---

## 6. Sales Discovery

**name:** `Sales Discovery`
**When:** an early-stage discovery call to qualify and understand a prospect.

**Why these outcomes:** discovery is qualification. The standard frameworks
(SPICED for the conversation, MEDDPICC for deal qualification) define what a good
discovery call must surface: the situation, the pain, the quantified impact, the
decision process and criteria, the economic buyer, the champion, the competition,
the paper/procurement process, and the critical event driving urgency. Capturing
these is what lets the deal be qualified and forecast honestly.

**instructions:**
```
You are enhancing notes for a sales discovery call. The job of the notes is
qualification: surface the prospect's situation, pain, and the information needed to
judge and advance the opportunity. Ground everything strictly in the transcript and
notes — discovery notes that invent detail are worse than useless. Produce these
sections, marking any genuinely uncovered-but-unanswered area "Not yet known" and
any untouched area "Not discussed":

- Summary: 2-4 sentences — who we spoke with, their context, and the headline
  takeaway on fit and opportunity.
- Attendees & roles: people present, titles, and apparent influence (user, champion,
  decision-maker, economic buyer) where discernible.
- Situation: the prospect's current state — environment, tools, team, relevant
  context.
- Pain & challenges: the problems and their root causes, in the prospect's own words
  where possible.
- Impact: the quantified or qualitative cost of those problems (time, money, risk,
  missed goals) — what it's costing them to not solve this.
- Desired outcome / success criteria: what a good solution looks like to them and
  how they'd measure success.
- Decision process & criteria: how they buy — who's involved, the steps, evaluation
  criteria, and any procurement/paper process or approvals mentioned.
- Economic buyer & champion: who controls budget, and who internally is advocating
  for change.
- Competition & alternatives: other vendors, internal builds, or doing nothing.
- Timeline / critical event: any deadline or compelling event creating urgency.
- Risks & open questions: gaps, red flags, and what still needs to be learned.
- Next steps: action_item blocks with owner and date, including who else needs to be
  brought into the next conversation.

Distinguish clearly between what the prospect actually said and what remains unknown.
Do not fabricate budget, authority, timelines, or names. A precise "we don't know X
yet" is a valid and valuable output.
```

---

## Notes & options
- **Framework depth:** the Sales Discovery and Sales Demo templates lean on
  SPICED/MEDDPICC thinking without forcing the jargon into the output. If you want
  the notes to explicitly label sections with framework terms (e.g. a literal
  "MEDDPICC" block), say so and the instructions can be adjusted — but plain-language
  sections usually read better for sharing internally.
- **Language per template:** if certain meeting types are always in a given language
  (e.g. internal syncs in Portuguese, customer demos in English), set that
  template's `language` to a fixed value so both transcription and notes lock to it.
- **Action-item house style:** all six ask for owner + due date on action items.
  If your team standardizes on a different convention (e.g. a priority tag), it's a
  one-line change in each template.
- **Seeding:** these map onto the built-in starter templates idea in
  `FEATURES_LANGUAGE_PROMPT_TEMPLATES.md` §C/§D — they can be seeded via migration as
  `is_builtin` templates, with `General` as `is_default`.
```
