import { useCallback, useState } from 'react';

// V074 block 02 — persisted sidebar layout. Renderer-only UI preference (no
// main-side observer), so we use localStorage rather than adding new IPC. The
// pinned top actions (New Note, Search, Ask-across-notes) are not in this
// model — they always render first and cannot be hidden or moved.

export type SidebarSection = 'folders' | 'tags' | 'agenda' | 'notes';

export type SidebarLayout = {
  order: SidebarSection[];
  hidden: SidebarSection[];
};

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  order: ['folders', 'tags', 'agenda', 'notes'],
  hidden: [],
};

const STORAGE_KEY = 'nexus:sidebar:layout';
const ALL_SECTIONS: SidebarSection[] = ['folders', 'tags', 'agenda', 'notes'];

function isSection(s: unknown): s is SidebarSection {
  return typeof s === 'string' && (ALL_SECTIONS as string[]).includes(s);
}

function readLayout(): SidebarLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SIDEBAR_LAYOUT;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SIDEBAR_LAYOUT;
    const obj = parsed as Record<string, unknown>;
    const rawOrder = Array.isArray(obj.order) ? obj.order : [];
    const rawHidden = Array.isArray(obj.hidden) ? obj.hidden : [];
    const filteredOrder = rawOrder.filter(isSection);
    // Append any sections introduced after this preference was saved, so a new
    // section becomes visible by default for upgraders.
    for (const s of ALL_SECTIONS) {
      if (!filteredOrder.includes(s)) filteredOrder.push(s);
    }
    const hidden = rawHidden.filter(isSection).filter((s) => filteredOrder.includes(s));
    return { order: filteredOrder, hidden };
  } catch {
    return DEFAULT_SIDEBAR_LAYOUT;
  }
}

function writeLayout(layout: SidebarLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // localStorage unavailable — the user just loses the preference next reload.
  }
}

export type SidebarLayoutController = {
  layout: SidebarLayout;
  visibleOrder: SidebarSection[];
  isHidden: (s: SidebarSection) => boolean;
  setOrder: (next: SidebarSection[]) => void;
  toggleHidden: (s: SidebarSection) => void;
  reset: () => void;
};

export function useSidebarLayout(): SidebarLayoutController {
  const [layout, setLayout] = useState<SidebarLayout>(() => readLayout());

  const update = useCallback((next: SidebarLayout): void => {
    setLayout(next);
    writeLayout(next);
  }, []);

  const setOrder = useCallback(
    (next: SidebarSection[]): void => {
      // Guard: drop any unknown ids and ensure every known section still appears
      // (any missing one is appended at the end so it remains reachable).
      const cleaned = next.filter(isSection);
      for (const s of ALL_SECTIONS) {
        if (!cleaned.includes(s)) cleaned.push(s);
      }
      update({ ...layout, order: cleaned });
    },
    [layout, update],
  );

  const toggleHidden = useCallback(
    (s: SidebarSection): void => {
      const isCurrentlyHidden = layout.hidden.includes(s);
      const nextHidden = isCurrentlyHidden
        ? layout.hidden.filter((h) => h !== s)
        : [...layout.hidden, s];
      update({ ...layout, hidden: nextHidden });
    },
    [layout, update],
  );

  const reset = useCallback((): void => {
    update(DEFAULT_SIDEBAR_LAYOUT);
  }, [update]);

  const visibleOrder = layout.order.filter((s) => !layout.hidden.includes(s));
  const isHidden = (s: SidebarSection): boolean => layout.hidden.includes(s);

  return { layout, visibleOrder, isHidden, setOrder, toggleHidden, reset };
}
