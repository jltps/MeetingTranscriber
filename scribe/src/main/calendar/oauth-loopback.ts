import http from 'node:http';
import { shell } from 'electron';

// Shared loopback capture for OAuth 2.0 + PKCE "installed app" flows (ROADMAP_06).
// It binds a one-shot HTTP server on the loopback interface, opens the consent
// page in the SYSTEM browser (CLAUDE.md §1.3 — never an Electron window), catches
// the redirect, validates the anti-CSRF state, and resolves with the auth code.
// Provider-specific bits (the auth URL, token exchange) live in each provider's
// oauth module; this just owns the redirect round-trip.
//
// `google-oauth.ts` predates this and keeps its own inline copy (it is live-tested
// — left untouched on purpose). New providers should use this helper.

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000; // user has 3 min to complete consent

const CALLBACK_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Scribe</title></head>' +
  '<body style="font-family:sans-serif;background:#0b0e12;color:#e5e5e5;display:flex;' +
  'align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>Scribe is connected.</h2>' +
  '<p>You can close this tab and return to the app.</p></div></body></html>';

export type CaptureLoopbackOptions = {
  /** Build the provider's authorization URL given the resolved loopback redirect. */
  buildAuthUrl: (redirectUri: string) => string;
  /** The anti-CSRF state value we expect back on the callback. */
  state: string;
  /** Loopback host to bind/advertise: '127.0.0.1' (Google) or 'localhost' (Entra). */
  host?: string;
  timeoutMs?: number;
};

/**
 * Run the loopback half of the flow: open consent, catch the redirect, and
 * resolve with `{ code, redirectUri }`. Rejects on denial, state mismatch,
 * timeout, or bind failure. The server is always closed before resolving.
 */
export function captureLoopbackCode(
  opts: CaptureLoopbackOptions,
): Promise<{ code: string; redirectUri: string }> {
  const host = opts.host ?? '127.0.0.1';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let redirectUri = '';

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML);
      finish(() => {
        if (error) throw new Error(`Authorization denied: ${error}`);
        if (returnedState !== opts.state) throw new Error('OAuth state mismatch — aborting.');
        if (!code) throw new Error('No authorization code returned.');
        return { code, redirectUri };
      });
    });

    const timer = setTimeout(() => {
      finish(() => {
        throw new Error('Timed out waiting for authorization.');
      });
    }, timeoutMs);

    function finish(produce: () => { code: string; redirectUri: string }): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      try {
        resolve(produce());
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    server.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    // Port 0 = OS picks a free port. Bind to loopback only.
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        finish(() => {
          throw new Error('Failed to bind loopback server.');
        });
        return;
      }
      redirectUri = `http://${host}:${addr.port}/callback`;
      void shell.openExternal(opts.buildAuthUrl(redirectUri));
    });
  });
}
