import { describe, it, expect, beforeEach, vi } from 'vitest';
import { persistenceService } from '@/services/persistenceService';
import type { SequencerStoreState } from '@/stores/sequencerStore';

const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe('persistenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceService.clear();
  });

  const createMockState = (): SequencerStoreState => ({
    patterns: {
      pattern0: {
        id: 'pattern0',
        patternNumber: 0,
        name: 'Pattern 1',
        tracks: {
          track0: {
            id: 'track0',
            trackNumber: 0,
            name: 'Track 1',
            steps: Array.from({ length: 16 }, (_, i) => ({
              id: `b${(i + 1).toString().padStart(2, '0')}`,
              enabled: false,
            })),
            midiChannel: '0000',
            muted: false,
            transpose: 0,
          },
        },
      },
    },
    currentPatternId: 'pattern0',
    nextPatternQueue: [],
    currentTrackId: 'track0',
    activeStepIndex: null,
    selectedStepId: null,
    bpm: 120,
    swing: 0,
    isPlaying: false,
    midiInputDevices: [],
    midiOutputDevices: [],
    selectedInputDeviceId: undefined,
    ledTargetDeviceId: undefined,
    midiLearnActive: false,
    lastLearnedControl: null,
    midiAssignments: {},
    ledOrder: [],
    trackSelectors: [],
    changePatternMode: false,
    pasteActive: false,
    lastNoteData: undefined,
    transposeModeActive: false,
    currentTransposeValue: 0,
  });

  describe('save', () => {
    it('should save state to localStorage', () => {
      const state = createMockState();
      const result = persistenceService.save(state);

      expect(result).toBe(true);
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
      
      const savedKey = mockLocalStorage.setItem.mock.calls[0][0];
      const savedValue = mockLocalStorage.setItem.mock.calls[0][1];
      
      expect(savedKey).toBe('sequencerState');
      const parsed = JSON.parse(savedValue);
      expect(parsed.version).toBe(1);
      expect(parsed.state.bpm).toBe(120);
    });

    it('should strip runtime state from saved data', () => {
      const state = createMockState();
      state.isPlaying = true;
      state.activeStepIndex = 5;
      state.midiInputDevices = [{ id: 'test', name: 'Test', type: 'input' }];

      persistenceService.save(state);

      const savedValue = mockLocalStorage.setItem.mock.calls[0][1];
      const parsed = JSON.parse(savedValue);
      
      expect(parsed.state.isPlaying).toBeUndefined();
      expect(parsed.state.activeStepIndex).toBeUndefined();
      expect(parsed.state.midiInputDevices).toBeUndefined();
    });

    it('should not save if state unchanged', () => {
      const state = createMockState();
      persistenceService.save(state);
      persistenceService.save(state);

      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
    });

    it('should handle save errors', () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage full');
      });

      const state = createMockState();
      const result = persistenceService.save(state);

      expect(result).toBe(false);
    });
  });

  describe('load', () => {
    it('should load state from localStorage', () => {
      const state = createMockState();
      const persistedData = {
        version: 1,
        timestamp: Date.now(),
        state: {
          patterns: state.patterns,
          currentPatternId: state.currentPatternId,
          nextPatternQueue: state.nextPatternQueue,
          currentTrackId: state.currentTrackId,
          selectedStepId: state.selectedStepId,
          bpm: 140,
          swing: 25,
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

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(persistedData));

      const loaded = persistenceService.load();

      expect(loaded).not.toBeNull();
      expect(loaded?.bpm).toBe(140);
      expect(loaded?.swing).toBe(25);
    });

    it('should return null if no saved state', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      const loaded = persistenceService.load();

      expect(loaded).toBeNull();
    });

    it('should return null on version mismatch', () => {
      const persistedData = {
        version: 999,
        timestamp: Date.now(),
        state: {},
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(persistedData));

      const loaded = persistenceService.load();

      expect(loaded).toBeNull();
    });

    it('should handle parse errors and clear storage', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json');

      const loaded = persistenceService.load();

      expect(loaded).toBeNull();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('sequencerState');
    });
  });

  describe('export/import', () => {
    it('should export state as formatted JSON', () => {
      const state = createMockState();
      const exported = persistenceService.export(state);

      expect(typeof exported).toBe('string');
      
      const parsed = JSON.parse(exported);
      expect(parsed.version).toBe(1);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.state).toBeDefined();
    });

    it('should import valid state JSON', () => {
      const state = createMockState();
      const exported = persistenceService.export(state);
      
      const imported = persistenceService.import(exported);

      expect(imported).not.toBeNull();
      expect(imported?.bpm).toBe(120);
    });

    it('should return null on import version mismatch', () => {
      const invalidData = JSON.stringify({
        version: 999,
        timestamp: Date.now(),
        state: {},
      });

      const imported = persistenceService.import(invalidData);

      expect(imported).toBeNull();
    });

    it('should return null on invalid JSON', () => {
      const imported = persistenceService.import('invalid json');

      expect(imported).toBeNull();
    });
  });

  describe('hasSavedState', () => {
    it('should return true if state exists', () => {
      mockLocalStorage.getItem.mockReturnValue('{}');

      expect(persistenceService.hasSavedState()).toBe(true);
    });

    it('should return false if no state exists', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      expect(persistenceService.hasSavedState()).toBe(false);
    });
  });

  describe('getLastSaveTime', () => {
    it('should return timestamp from saved state', () => {
      const now = Date.now();
      const persistedData = {
        version: 1,
        timestamp: now,
        state: {},
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(persistedData));

      expect(persistenceService.getLastSaveTime()).toBe(now);
    });

    it('should return null if no saved state', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      expect(persistenceService.getLastSaveTime()).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove state from localStorage', () => {
      persistenceService.clear();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('sequencerState');
    });
  });
});
