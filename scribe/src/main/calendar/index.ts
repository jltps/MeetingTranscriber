import { BrowserWindow } from 'electron';
import type { CalendarProvider } from './provider';
import type { CalendarProviderId } from '../../shared/types';
import { GoogleCalendarProvider } from './google-provider';
import { IPC } from '../../shared/ipc-contract';
import {
  clearProviderEvents,
  listAgendaEvents,
  pruneEvents,
  upsertEvents,
} from '../db/calendar';
import { logger } from '../logger';

// Calendar provider factory + sync service (ROADMAP_06). The factory keeps the
// rest of the app off concrete providers (CLAUDE.md §5). The sync service owns
// the poll loop, fetch-on-connect, pruning, and pushing the merged agenda to the
// renderer. The renderer owns the agenda UI + auto-start (capture is renderer-side).

const SYNC_WINDOW_DAYS = 14;
const POLL_MS = 5 * 60 * 1000;
const PRUNE_GRACE_MS = 60 * 60 * 1000; // keep events that ended within the last hour

// Single instance per implemented provider. Phase 1 ships Google only; Microsoft
// slots in here in Phase 2 (a second entry, no other change — the rest is
// provider-agnostic).
const providers: Partial<Record<CalendarProviderId, CalendarProvider>> = {
  google: new GoogleCalendarProvider(),
  // microsoft: new MicrosoftCalendarProvider(),  // Phase 2
};

export function getProvider(id: CalendarProviderId): CalendarProvider {
  const provider = providers[id];
  if (!provider) throw new Error(`Calendar provider "${id}" is not available.`);
  return provider;
}

function connectedProviders(): CalendarProvider[] {
  return Object.values(providers).filter((p): p is CalendarProvider => p.isConnected());
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Push the merged agenda to the renderer (same pattern as whisper progress). */
export function pushAgenda(): void {
  const agenda = listAgendaEvents();
  BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.calendarAgenda, agenda);
}

/** Fetch + cache events for one provider over the sync window, then prune stale. */
async function syncProvider(provider: CalendarProvider): Promise<void> {
  const now = Date.now();
  const toMs = now + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const events = await provider.listUpcoming({ fromMs: now - PRUNE_GRACE_MS, toMs });
  upsertEvents(provider.id, events);
  pruneEvents(
    provider.id,
    events.map((e) => e.externalId),
    now - PRUNE_GRACE_MS,
  );
}

/** Re-sync every connected provider, then push the merged agenda. */
export async function syncNow(): Promise<void> {
  for (const provider of connectedProviders()) {
    try {
      await syncProvider(provider);
    } catch (err) {
      logger.error(
        `Calendar sync failed for ${provider.id}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
  pushAgenda();
}

/** Start (or restart) the poll loop if any provider is connected. Idempotent. */
export function startCalendarSync(): void {
  if (connectedProviders().length === 0) return;
  if (pollTimer) return;
  void syncNow();
  pollTimer = setInterval(() => void syncNow(), POLL_MS);
}

export function stopCalendarSync(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Disconnect a provider: revoke tokens, drop its cached events, refresh agenda. */
export async function disconnectProvider(id: CalendarProviderId): Promise<void> {
  await getProvider(id).disconnect();
  clearProviderEvents(id);
  if (connectedProviders().length === 0) stopCalendarSync();
  pushAgenda();
}
