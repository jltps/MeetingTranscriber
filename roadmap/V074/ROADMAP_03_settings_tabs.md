# V074 — Block 03 — Settings vertical-tab restructure

## Why

`SettingsModal.tsx` is one 700-line vertical scroll with 11 sections in
arbitrary order. There is no grouping, no navigation, and a destructive
"wipe data" button at the bottom sits one scroll away from API keys at
the top. Every change requires hunting through the whole modal.

## What

Restructure the JSX inside `<DialogContent>` into a left-rail vertical
tab navigator. Keep every existing state, effect, IPC call, and handler
untouched — they all stay hoisted at the top of `SettingsModal` so
switching tabs preserves in-progress edits (important for the
API-key reveal/edit flow which has unsaved local state).

### Tabs (in order)

| Tab | Contents (regrouped from existing sections) |
|---|---|
| **General** | Appearance (theme), Language (moved out of Audio — it's a global preference, not a mic-device thing) |
| **AI** | API keys (Anthropic + Deepgram), AI provider (Anthropic vs OpenAI-compatible), Cost & quality toggle, Enhancement custom instructions |
| **Audio** | Microphone device, Listening mode (Auto/Headphones/Speakers) |
| **Transcription** | Cloud (Deepgram) vs Local (Whisper) toggle, Whisper model manager |
| **Calendar** | `CalendarSettingsSection` (unchanged) |
| **Templates** | "Manage templates" button → opens the V074 Block 04 full-screen Templates page and closes Settings |
| **Updates** | `UpdatesSection` (unchanged) |
| **Usage & Cost** | Existing pricing/usage block (unchanged) |
| **Data** | Backup, Restore |
| **Privacy** | Wipe all local data (V074 Block 06's new typed-confirm Dialog) |

### Shell

```jsx
<DialogContent className="sm:max-w-4xl h-[80vh] p-0">
  <DialogHeader className="px-6 pt-5 pb-3">
    <DialogTitle>Settings</DialogTitle>
    <DialogDescription>…</DialogDescription>
  </DialogHeader>
  <div className="grid grid-cols-[180px_1fr] h-[calc(80vh-5rem)] border-t border-border">
    <nav className="border-r border-border p-2 space-y-1 overflow-y-auto">
      {/* vertical tab buttons */}
    </nav>
    <div className="overflow-y-auto p-6">{renderTab(activeTab)}</div>
  </div>
</DialogContent>
```

Use the existing shadcn `Tabs` primitive (Radix) with
`orientation="vertical"` — it's already part of the component
vocabulary (`renderer/components/ui/tabs.tsx` exists). The tab list
becomes the left nav; tab content fills the right pane.

Persist the last opened tab to KV under `settings_last_tab`. When
opening Settings, default to the persisted tab; fall back to General.

### Extraction

Each tab body is its own inline render function (`renderGeneral`,
`renderAi`, …) so the file stays one place. Sections that already exist
as standalone components (`UpdatesSection`, `CalendarSettingsSection`)
stay as-is. Big new bodies (`AiTab`, `AudioTab`, `TranscriptionTab`)
can move to `features/settings/sections/` later if they grow — for V074
keep them inline to minimise diff churn.

## Hold the invariants

Pure JSX restructure. No new IPC. No behaviour change in any setting.
KV write for `settings_last_tab` goes through the existing
`settings:setKv` channel.

## Verify

`pnpm dev`:

- Open Settings → tabs appear; default tab is "General" on first open.
- Switch to Audio → change mic → switch to Calendar → return to Audio:
  the unsaved selection is still there.
- Close + reopen Settings → opens to the last-used tab.
- Every existing setting still saves and round-trips through reload.
