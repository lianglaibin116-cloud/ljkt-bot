'use client';

import { useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/lib/store/settings';

function subscribe(listener: () => void): () => void {
  const start = useSettingsStore.persist.onHydrate(listener);
  const finish = useSettingsStore.persist.onFinishHydration(listener);
  return () => {
    start();
    finish();
  };
}

/** A new frame has its own store instance: wait for its saved model configuration. */
export function useSettingsHydrated(): boolean {
  return useSyncExternalStore(subscribe, useSettingsStore.persist.hasHydrated, () => false);
}
