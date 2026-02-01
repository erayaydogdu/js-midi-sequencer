/**
 * Persistence Service - Handles saving and loading sequencer state
 * 
 * Provides:
 * - localStorage abstraction
 * - State serialization/deserialization
 * - Auto-save functionality
 * - Migration handling
 */

import type { SequencerStoreState } from '@/stores/sequencerStore';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'sequencerState';
const STORAGE_VERSION = 1;

// ============================================================================
// Types
// ============================================================================

export interface PersistedState {
  version: number;
  timestamp: number;
  state: Omit<SequencerStoreState, 
    | 'midiInputDevices' 
    | 'midiOutputDevices' 
    | 'isPlaying' 
    | 'activeStepIndex' 
    | 'lastLearnedControl' 
    | 'midiLearnActive'
  >;
}

export interface PersistenceOptions {
  autoSaveInterval?: number; // ms, 0 to disable
  debounceMs?: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

class PersistenceService {
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedState: string | null = null;

  /**
   * Load state from localStorage
   */
  load(): Partial<SequencerStoreState> | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;

      const parsed: PersistedState = JSON.parse(saved);

      // Version check for migrations
      if (parsed.version !== STORAGE_VERSION) {
        console.warn(`State version mismatch: ${parsed.version} vs ${STORAGE_VERSION}`);
        // Could implement migration logic here
        return null;
      }

      return parsed.state;
    } catch (error) {
      console.error('Failed to load state:', error);
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  /**
   * Save state to localStorage
   */
  save(state: SequencerStoreState): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      // Strip runtime/transient state
      const stateToSave: PersistedState = {
        version: STORAGE_VERSION,
        timestamp: Date.now(),
        state: {
          patterns: state.patterns,
          currentPatternId: state.currentPatternId,
          nextPatternQueue: state.nextPatternQueue,
          currentTrackId: state.currentTrackId,
          selectedStepId: state.selectedStepId,
          bpm: state.bpm,
          swing: state.swing,
          selectedInputDeviceId: state.selectedInputDeviceId,
          ledTargetDeviceId: state.ledTargetDeviceId,
          midiAssignments: state.midiAssignments,
          ledOrder: state.ledOrder,
          trackSelectors: state.trackSelectors,
          changePatternMode: state.changePatternMode,
          pasteActive: state.pasteActive,
          lastNoteData: state.lastNoteData,
          transposeModeActive: state.transposeModeActive,
          currentTransposeValue: state.currentTransposeValue,
        },
      };

      const serialized = JSON.stringify(stateToSave);
      
      // Don't save if unchanged
      if (serialized === this.lastSavedState) {
        return true;
      }

      localStorage.setItem(STORAGE_KEY, serialized);
      this.lastSavedState = serialized;
      
      return true;
    } catch (error) {
      console.error('Failed to save state:', error);
      return false;
    }
  }

  /**
   * Debounced save - useful for rapid state changes
   */
  saveDebounced(state: SequencerStoreState, delayMs: number = 500): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.save(state);
    }, delayMs);
  }

  /**
   * Enable auto-save at specified interval
   */
  enableAutoSave(
    getState: () => SequencerStoreState, 
    intervalMs: number = 5000
  ): void {
    this.disableAutoSave();

    this.autoSaveTimer = setInterval(() => {
      this.save(getState());
    }, intervalMs);
  }

  /**
   * Disable auto-save
   */
  disableAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Clear saved state
   */
  clear(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.lastSavedState = null;
  }

  /**
   * Export state as JSON string (for manual backup)
   */
  export(state: SequencerStoreState): string {
    const exportData: PersistedState = {
      version: STORAGE_VERSION,
      timestamp: Date.now(),
      state: {
        patterns: state.patterns,
        currentPatternId: state.currentPatternId,
        nextPatternQueue: state.nextPatternQueue,
        currentTrackId: state.currentTrackId,
        selectedStepId: state.selectedStepId,
        bpm: state.bpm,
        swing: state.swing,
        selectedInputDeviceId: state.selectedInputDeviceId,
        ledTargetDeviceId: state.ledTargetDeviceId,
        midiAssignments: state.midiAssignments,
        ledOrder: state.ledOrder,
        trackSelectors: state.trackSelectors,
        changePatternMode: state.changePatternMode,
        pasteActive: state.pasteActive,
        lastNoteData: state.lastNoteData,
        transposeModeActive: state.transposeModeActive,
        currentTransposeValue: state.currentTransposeValue,
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import state from JSON string
   */
  import(jsonString: string): Partial<SequencerStoreState> | null {
    try {
      const parsed: PersistedState = JSON.parse(jsonString);

      if (parsed.version !== STORAGE_VERSION) {
        throw new Error(`Version mismatch: ${parsed.version} vs ${STORAGE_VERSION}`);
      }

      return parsed.state;
    } catch (error) {
      console.error('Failed to import state:', error);
      return null;
    }
  }

  /**
   * Check if there's saved state
   */
  hasSavedState(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  /**
   * Get last save timestamp
   */
  getLastSaveTime(): number | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;

      const parsed: PersistedState = JSON.parse(saved);
      return parsed.timestamp;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const persistenceService = new PersistenceService();
export default persistenceService;
