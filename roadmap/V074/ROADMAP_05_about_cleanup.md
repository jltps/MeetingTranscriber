# V074 — Block 05 — About dialog cleanup

## Why

`AboutDialog.tsx` (the modal opened from the title-bar Info button)
exposes three buttons: **Releases**, **Source**, and **Check for
updates**. The V07 auto-updater shipped per-app update notifications +
a Settings → Updates section, so Releases is redundant. Source leaks
the public GitHub repo into the product UI — fine in dev, off-key in
the polished consumer surface.

## What

Edit `scribe/src/renderer/features/updates/AboutDialog.tsx` lines 51–60.

Remove the two `outline` buttons. Leave the "Check for updates" button
in place:

```jsx
<div className="flex flex-wrap gap-2">
  <Button size="sm" onClick={onCheckUpdates}>
    Check for updates
  </Button>
</div>
```

If `window.api.openExternal('releases' | 'repo')` has no remaining
callers afterwards, **leave the IPC channel in place** — removing it
is a contract change and not in scope for V074.

## Hold the invariants

No-op for §1 — this is a JSX deletion only.

## Verify

`pnpm dev` → click the Info button → About Nexus dialog shows the logo,
description, version row, and a single "Check for updates" button.
