# ROADMAP_00_INDEX.md

The V04 backlog for the app — the **UI/UX phase**. v1→v3 shipped the *functionality*
(capture, transcription, enhancement, templates, language, speaker naming,
export/backup, offline Whisper, calendar auto-start, cross-meeting chat). V04 is the
first phase that invests in how the app **looks, feels, is branded, and is organized**.
It also ships the headline rebrand: the product is renamed **Scribe → Nexus**.

Like v03, each block has its own file and can be specced into Claude Code on its own.
This index explains the grouping, dependencies, and a suggested order.

> **V04 is UI/UX only.** No block changes audio, transcription, the enhancer, the
> calendar sync, or any `CLAUDE.md` §1 *behavior*. The safety surface is untouched.
> Two invariants sit *near* the work and must be held exactly as today:
> **§1.2** — API keys never reach the renderer in plaintext and never get logged
> (relevant to the onboarding connect-keys flow, block 07); **§1.3** — the renderer
> stays untrusted (`contextIsolation`/`sandbox`/no Node), so every new IPC channel
> (theme, organization, ui-prefs) goes through the shared contract with a Zod schema,
> same discipline as existing channels. Going frameless (block 03) does **not** relax
> this posture.

## The blocks

| # | Block | What it is | Type |
|---|---|---|---|
| 01 | Design Foundation: Tailwind v4 + Tokens + Theming | CSS-variable design tokens; light/dark/system synced to `nativeTheme` | Foundation |
| 02 | Component System: shadcn/ui + lucide | Replace hand-rolled modals/dropdowns/buttons and emoji "icons" | Foundation |
| 03 | App Shell: Frameless + Custom Title Bar | Drop the native menu; branded title bar; in-app action registry | Foundation |
| 04 | Note Organization: Folders + Tags | Hierarchy + flat tags; also become cross-meeting-chat scopes | Feature (DB+IPC+UI) |
| 05 | Command Palette + Keyboard Shortcuts | Ctrl/Cmd-K palette over the action registry | Feature |
| 06 | Layout & Window-State | Persist size/position/split; responsive narrow-width tabs | Feature |
| 07 | Onboarding & Empty States | First-run flow, connect-keys, polished empties | Feature |
| 08 | Accessibility | Keyboard nav, focus, AA contrast both themes, reduced-motion, ARIA | Quality |
| 09 | Rebrand to Nexus | Name, icon, logo, installer, title-bar identity | Feature |

## Dependencies

```
01 Tokens + theming ─┬─► 02 shadcn/lucide ─► 03 App shell ─┬─► 05 Command palette
 (must be first;     │      (everything       (chrome the   └─► 06 Layout / window-state
  everything         │       visual refactors  palette and
  consumes tokens)   │       onto it)          layout sit in)
                     ├─► 07 Onboarding & empty states
                     └─► 08 Accessibility (audits 02–07; some a11y built inline per block)

04 Note org ── DB/IPC side is independent of theming; can start at step 1.
               Its UI dressing lands on 02. Wires folders/tags into the existing
               cross-meeting chat scope (RetrievalScope).

09 Rebrand ── name/appId/icon/installer are independent (start anytime).
              Title-bar identity merges after 03; accent color comes from 01.
```

## Suggested order

1. **01 Design foundation** first — a hard prerequisite. It establishes the semantic
   tokens, the emerald/teal accent, light/dark/system, and the FOUC-free theme
   bootstrap. Nothing else should be styled before tokens exist.
2. **02 Component system** next — every modal/dropdown/button/icon refactors onto
   shadcn + lucide, so do it before the shell so the title bar uses real components.
3. **03 App shell** — frameless window, custom title bar, native menu removed, and the
   action registry that the title-bar menu and the command palette both read.
4. **04 Note organization** can run in parallel from step 1: its DB/IPC/retrieval work
   is independent; only its UI depends on 02. Folder/tag delete safety (§7) lives here.
5. **05 Command palette** — needs 02 (Dialog/command) and 03 (action registry).
6. **06 Layout & window-state** — needs 03 (frameless) and 01 (bootstrap pattern).
7. **07 Onboarding & empty states** — needs 01 + 02; reuses the existing keys path (§1.2).
8. **08 Accessibility** — the dedicated sweep over 02–07 (inline a11y is built per block).
9. **09 Rebrand** — name/appId/icon/installer land independently; identity after 03.

## Cross-cutting notes (hold across every block)

- **CSP stays unchanged.** shadcn/ui + Radix are bundled JS (`script-src 'self'`),
  lucide renders inline `<svg>` (no network, no font, no `data:`), Tailwind v4 emits a
  static stylesheet (inline styles already allowed by `style-src 'unsafe-inline'`). The
  *only* thing that would force a CSP change is a brand **webfont** — if one is ever
  wanted, self-host the woff2 so `font-src 'self'` still holds. Default plan: no font,
  no CSP change.
- **FOUC.** The renderer is sandboxed and gets settings via async IPC, so any theme read
  through `window.api` lands after first paint. Block 01 solves this pre-paint (main sets
  `nativeTheme.themeSource` before load + an inline `<script>` in `index.html` applies
  the theme class synchronously). Window `backgroundColor` follows the effective theme.
- **Migrations only (§7).** Only block 04 touches the schema — additively, as migration
  v9. Deleting a folder must **null** its meetings' `folder_id`, never delete the
  meetings.
- **No second way of doing something (§5).** Refactors *replace* the hand-rolled
  pattern; they don't add a parallel one.

## How to use a block with Claude Code

Feed the block file plus the codebase. Same discipline as v03: read the existing code,
propose the fit before writing, ship as its own branch, migrations only against the
populated DB, hold the §1 invariants, and keep `pnpm typecheck/lint/test/build` green.
