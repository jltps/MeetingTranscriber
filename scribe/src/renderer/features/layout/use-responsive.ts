import { useEffect, useState } from 'react';

// Below this window width the meeting view reflows from side-by-side panels to a
// single-column tab set and the sidebar becomes a drawer (ROADMAP_V04_06).
export const NARROW_BREAKPOINT = 860;

export type LayoutMode = 'wide' | 'narrow';

function current(): LayoutMode {
  return typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT
    ? 'narrow'
    : 'wide';
}

/** Tracks whether the window is wide enough for the side-by-side layout. */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(current);
  useEffect(() => {
    const onResize = (): void => setMode(current());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mode;
}
