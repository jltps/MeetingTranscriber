# ROADMAP_01 — Launch Screen

## Problem

Today, Nexus paints a blank-then-empty window during the first few hundred
milliseconds after the user double-clicks the icon. The main process
creates a `BrowserWindow` with `show: false` and waits for `ready-to-show`
before calling `.show()` (`scribe/src/main/index.ts:80`), so technically
the user doesn't see the flash of unstyled content — but they also see
*nothing at all* until the renderer is fully ready. On a cold start
(no OS cache), that gap can feel sluggish and the user has no signal that
the app is actually launching.

## Goal

Show a small, branded splash window the moment the user launches Nexus,
then swap to the main window as soon as the renderer is ready to display.

## Non-goals

- A progress bar / boot diagnostics screen — splash is purely a "we're
  starting" indicator, not a status display.
- Reusing the splash for in-app loading states (those are renderer-only).
- A multi-second splash hold for branding — the splash must disappear as
  soon as the main window is ready, even if that's <500 ms.
- Native Windows shell launch screen (manifest-based) — that's
  install-time wiring, not in scope here.

## Approach

A native Electron splash window owned by the main process, shown
immediately on `app.whenReady`, hidden when the main window emits
`ready-to-show`.

### `scribe/src/main/splash.ts` (new)

A small module exporting:

```
createSplash(): BrowserWindow
closeSplash(win: BrowserWindow): void
```

- `createSplash()` creates a frameless, non-resizable, transparent
  `BrowserWindow` (~360×220, centered on the primary display).
  `alwaysOnTop: true`, `skipTaskbar: true`, `show: true`.
- Loads a tiny self-contained HTML file with the Nexus logo + app name +
  a subtle pulse animation; CSS-only, no JS, no IPC, no network. Ship as
  `scribe/build/splash.html` so it's available in both dev and packaged.
- Background colour matches the renderer's current theme background. Read
  the persisted theme from `scribe/src/main/db/settings.ts` (`theme_mode`)
  via the same path `initTheme()` uses, so light-mode users see a light
  splash and dark-mode users see a dark splash. If `system`, defer to
  `nativeTheme.shouldUseDarkColors`.
- `closeSplash(win)` calls `win.destroy()` after `mainWindow.show()`.

### Wire-up in `scribe/src/main/index.ts`

In the `app.whenReady` handler (currently lines 96–110), reorder so the
splash appears as early as possible:

```
await app.whenReady();
const splash = createSplash();          // shows immediately
hardenSession();
setupAudioCapture();
initDb();
initTheme();
Menu.setApplicationMenu(null);
registerIpcHandlers();
createWindow();                          // existing
mainWindow.once('ready-to-show', () => {
  mainWindow.show();
  closeSplash(splash);
});
```

The existing `ready-to-show` handler in `createWindow()` already calls
`.show()` (line 80); move the `closeSplash` call alongside it. Verify by
reading `createWindow()` during implementation; if it owns the show, just
inject the close-splash callback there rather than duplicating the
listener.

### Splash HTML / styling

- **Reuse** `scribe/src/renderer/assets/logo.svg` (256×256, Nexus monogram)
  by inlining it as `<svg>` in `splash.html` (so it works without any
  bundler / asset pipeline). Alternative: copy it to `scribe/build/` and
  reference via `file://`.
- Typography: system font stack (no web-font load — that would defeat the
  point).
- Animation: a 2 s `opacity` pulse on the logo using pure CSS keyframes;
  honour `@media (prefers-reduced-motion: reduce)` and disable.
- No interactive elements; pointer-events disabled.

### Dev-mode behavior

The splash should appear in dev too (otherwise we never see it during
implementation). The Vite dev server's slower-than-prod renderer boot
actually makes dev a better test bed for the splash UX.

## Verification

1. `corepack pnpm dev` — splash flashes immediately, main window appears
   when ready. Both in dark and light theme (toggle via Settings, restart).
2. `corepack pnpm dist` — packaged install on a clean Windows user shows
   the splash within ~50 ms of double-click, dismisses smoothly when the
   main window is ready.
3. Toggle `prefers-reduced-motion` in OS settings — splash pulse stops
   animating.
4. Confirm splash is `skipTaskbar: true` (no second taskbar entry briefly
   appearing).
5. Confirm splash dismisses even if main window's `ready-to-show` is slow
   (synthetic test: temporarily add a `setTimeout(2000)` before
   `mainWindow.show()` and confirm the splash stays visible until the
   main appears).

### Type/lint/test/build gates

`corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test &&
corepack pnpm build` all clean.

## §1 invariants — affirmation checklist

- **§1.1 No audio.** Unaffected.
- **§1.2 No keys.** Splash HTML is static — no network, no IPC.
- **§1.3 Renderer untrusted.** Splash window has no `preload`, no
  `nodeIntegration`, no `webSecurity: false`. It's an HTML island.
- **§1.5 User notes.** Unaffected.
- **§1.6 / §1.7.** Unaffected.

## Acceptance

- `scribe/src/main/splash.ts` + `scribe/build/splash.html` ship.
- Splash appears within a few hundred ms of launch and dismisses on
  `ready-to-show`.
- Honours persisted theme + reduced-motion preference.
- Manual verification passed for both dev and packaged builds.
- One commit, directly to `main`, Conventional Commits
  (`feat(ui): splash screen on app launch`).
