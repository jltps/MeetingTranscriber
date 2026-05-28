import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/ipc-contract';

// Subscribe to the main-process updater state machine (V07 block 02). Seeds
// from getState() and updates on every onStatus push.
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void window.api.updates.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const unsub = window.api.updates.onStatus(setState);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return state;
}
