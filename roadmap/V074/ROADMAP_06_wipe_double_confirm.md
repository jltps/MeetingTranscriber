# V074 — Block 06 — Double-confirm "Wipe all local data"

## Why

The Privacy section's "Wipe all local data" button is gated only by a
single native `window.confirm()` (line 172 of `SettingsModal.tsx`). It
deletes every meeting, transcript, note, template, saved key, and KV
row, with no recovery. A misclick after dismissing the confirm is too
cheap.

## What

Replace the `window.confirm()` with a typed-confirmation Dialog.

### Behaviour

- Click the destructive button → open a `<Dialog>` titled "Wipe all
  local data?" with an expanded warning body: "This will permanently
  delete every meeting, transcript, note, template, and saved API key.
  It cannot be undone."
- The dialog contains an `<Input>` with `placeholder="Type WIPE to
  confirm"`.
- A footer destructive button "Wipe everything" (`variant="destructive"`)
  stays `disabled` until the input equals the literal string `WIPE`
  (case-sensitive — matches the placeholder).
- A "Cancel" button (`variant="outline"`) on the left of the footer
  closes the dialog without action.
- On confirm: call the existing `window.api.settings.wipe()` + the
  existing `onWiped()` callback, then close the dialog.

### Files

- Edit `scribe/src/renderer/features/settings/SettingsModal.tsx`:
  - Replace the existing `onWipe` confirm-only handler with state
    that opens the new dialog.
  - Render the dialog at the bottom of the Privacy tab (Block 03 moves
    the button into the Privacy tab — the dialog lives wherever the
    button does).

No new IPC — `window.api.settings.wipe()` is unchanged.

## Hold the invariants

The destructive action is unchanged on the wire; only the UX gate
hardens. §1 is unaffected.

## Verify

`pnpm dev`:

- Open Settings → Privacy → click "Wipe all local data" → dialog
  appears, "Wipe everything" disabled.
- Type "wipe" (lowercase) → still disabled.
- Type "WIPE" → enabled.
- Click "Wipe everything" → all data wiped; sidebar empties; Settings
  closes/refreshes per `onWiped`.
- Cancel at any point closes the dialog without wiping.
