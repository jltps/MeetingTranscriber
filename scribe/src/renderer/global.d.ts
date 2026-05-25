import type { ScribeApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    api: ScribeApi;
  }
}

export {};
