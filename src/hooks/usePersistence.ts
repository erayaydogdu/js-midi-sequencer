/**
 * usePersistence Hook - Manages state persistence
 * 
 * Handles:
 * - Loading saved state on mount
 * - Auto-saving state changes
 * - Manual save/load operations
 */

import { useEffect, useCallback } from 'react';
import { useSequencerStore } from '@/stores/sequencerStore';
import { persistenceService } from '@/services/persistenceService';

export interface UsePersistenceOptions {
  autoSaveInterval?: number;
  loadOnMount?: boolean;
}

export function usePersistence(options: UsePersistenceOptions = {}) {
  const { autoSaveInterval = 5000, loadOnMount = true } = options;
  const store = useSequencerStore();

  // Load saved state on mount
  useEffect(() => {
    if (!loadOnMount) return;

    const savedState = persistenceService.load();
    if (savedState) {
      // Use a timeout to avoid triggering during render
      const timeoutId = setTimeout(() => {
        useSequencerStore.getState().loadState(savedState);
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [loadOnMount]); // Remove store from dependencies to prevent loop

  // Enable auto-save
  useEffect(() => {
    if (autoSaveInterval <= 0) return;

    persistenceService.enableAutoSave(() => useSequencerStore.getState(), autoSaveInterval);

    return () => {
      persistenceService.disableAutoSave();
    };
  }, [autoSaveInterval]);

  // Manual save
  const save = useCallback(() => {
    return persistenceService.save(useSequencerStore.getState());
  }, []);

  // Manual load
  const load = useCallback(() => {
    const savedState = persistenceService.load();
    if (savedState) {
      store.loadState(savedState);
      return true;
    }
    return false;
  }, [store]);

  // Clear saved state
  const clear = useCallback(() => {
    persistenceService.clear();
    store.resetState();
  }, [store]);

  // Export state as JSON
  const exportState = useCallback(() => {
    return persistenceService.export(useSequencerStore.getState());
  }, []);

  // Import state from JSON
  const importState = useCallback((jsonString: string) => {
    const state = persistenceService.import(jsonString);
    if (state) {
      store.loadState(state);
      return true;
    }
    return false;
  }, [store]);

  // Check if there's saved state
  const hasSavedState = persistenceService.hasSavedState();
  
  // Get last save time
  const lastSaveTime = persistenceService.getLastSaveTime();

  return {
    save,
    load,
    clear,
    exportState,
    importState,
    hasSavedState,
    lastSaveTime,
  };
}

export default usePersistence;
