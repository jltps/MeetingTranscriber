import { useEffect, useMemo, useRef } from 'react';

// Returns a stable debounced wrapper that always calls the latest `fn`. The
// pending timer is cleared on unmount so callers can pair this with their own
// flush-on-unmount logic without a stray late call.
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = useMemo(
    () =>
      (...args: A): void => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => fnRef.current(...args), delay);
      },
    [delay],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return debounced;
}
