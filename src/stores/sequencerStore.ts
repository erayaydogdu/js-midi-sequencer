/**
 * Sequencer Store - Zustand-based state management
 * 
 * This store centralizes all sequencer state using Zustand with Immer middleware
 * for immutable updates. State is organized into logical slices:
 * - Pattern management
 * - Track management  
 * - Playback state
 * - MIDI configuration
 * - UI state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Step, Track, Pattern, MIDIDevice, MidiAssignments } from '@/types/sequencer';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_BPM = 120;
export const DEFAULT_SWING = 0;
export const STEPS_PER_PATTERN = 16;
export const DEFAULT_VELOCITY = 100;
export const DEFAULT_NOTE_LENGTH = 1;

// ============================================================================
// Helper Functions
// ============================================================================

export const createInitialStep = (index: number): Step => ({
  id: `b${(index + 1).toString().padStart(2, '0')}`,
  enabled: false,
});

export const createInitialTrack = (trackNumber: number): Track => ({
  id: `track${trackNumber}`,
  trackNumber,
  name: `Track ${trackNumber + 1}`,
  steps: Array.from({ length: STEPS_PER_PATTERN }, (_, i) => createInitialStep(i)),
  midiChannel: trackNumber.toString(16).padStart(4, '0'),
  muted: false,
  outputDeviceId: undefined,
  transpose: 0,
});

export const createInitialPattern = (patternNumber: number): Pattern => ({
  id: `pattern${patternNumber}`,
  patternNumber,
  name: `Pattern ${patternNumber + 1}`,
  tracks: { 'track0': createInitialTrack(0) },
});

// ============================================================================
// State Interfaces
// ============================================================================

export interface SequencerStoreState {
  // Pattern State
  patterns: Record<string, Pattern>;
  currentPatternId: string;
  nextPatternQueue: string[];
  
  // Track State
  currentTrackId: string;
  
  // Playback State
  activeStepIndex: number | null;
  bpm: number;
  swing: number;
  isPlaying: boolean;
  
  // MIDI State
  midiInputDevices: MIDIDevice[];
  midiOutputDevices: MIDIDevice[];
  selectedInputDeviceId?: string;
  ledTargetDeviceId?: string;
  midiLearnActive: boolean;
  lastLearnedControl: number | null;
  midiAssignments: Record<string, number>;
  ledOrder: number[];
  trackSelectors: number[];
  
  // UI State
  selectedStepId: string | null;
  changePatternMode: boolean;
  pasteActive: boolean;
  lastNoteData?: Pick<Step, 'notePitch' | 'velocity' | 'noteLength'>;
  transposeModeActive: boolean;
  currentTransposeValue: number;
}

// ============================================================================
// Initial State
// ============================================================================

const createInitialState = (): SequencerStoreState => {
  const initialPattern = createInitialPattern(0);
  
  return {
    patterns: { [initialPattern.id]: initialPattern },
    currentPatternId: initialPattern.id,
    nextPatternQueue: [],
    currentTrackId: initialPattern.tracks['track0'].id,
    activeStepIndex: null,
    selectedStepId: null,
    bpm: DEFAULT_BPM,
    swing: DEFAULT_SWING,
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
  };
};

// ============================================================================
// Actions Interface
// ============================================================================

export interface SequencerStoreActions {
  // Pattern Actions
  addPattern: (patternNum?: number) => Pattern;
  deletePattern: (id: string) => boolean;
  selectPattern: (id: string) => void;
  copyPattern: (sourceId: string) => Pattern | null;
  queuePattern: (id: string) => void;
  clearPatternQueue: () => void;
  
  // Track Actions
  addTrack: (trackNum?: number) => Track;
  deleteTrack: (id: string) => boolean;
  selectTrack: (id: string) => void;
  updateTrack: (id: string, updates: Partial<Track>) => void;
  toggleTrackMute: (id: string) => void;
  clearTrack: (id: string) => void;
  
  // Step Actions
  toggleStep: (stepId: string, forceClear?: boolean, noteData?: Pick<Step, 'notePitch' | 'velocity' | 'noteLength'>) => void;
  selectStep: (stepId: string | null) => void;
  updateStep: (stepId: string, updates: Partial<Step>) => void;
  clearAllSteps: () => void;
  
  // Playback Actions
  play: () => void;
  stop: () => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setActiveStep: (index: number | null) => void;
  advanceStep: () => void;
  
  // MIDI Actions
  setMidiDevices: (inputs: MIDIDevice[], outputs: MIDIDevice[]) => void;
  selectInputDevice: (id: string | undefined) => void;
  toggleMidiLearn: () => void;
  setLastLearnedControl: (cc: number | null) => void;
  saveMidiAssignments: (assignments: MidiAssignments) => void;
  
  // UI Actions
  setChangePatternMode: (active: boolean) => void;
  setPasteActive: (active: boolean) => void;
  setTransposeMode: (active: boolean) => void;
  setTransposeValue: (value: number) => void;
  
  // Persistence
  loadState: (state: Partial<SequencerStoreState>) => void;
  resetState: () => void;
}

// ============================================================================
// Store Creation
// ============================================================================

export type SequencerStore = SequencerStoreState & SequencerStoreActions;

export const useSequencerStore = create<SequencerStore>()(
  immer((set, get) => ({
    ...createInitialState(),

    // =========================================================================
    // Pattern Actions
    // =========================================================================
    
    addPattern: (patternNum?: number) => {
      const state = get();
      let newPatternNum = patternNum ?? -1;
      
      if (newPatternNum === -1) {
        const existingNumbers = Object.values(state.patterns).map(p => p.patternNumber);
        newPatternNum = 0;
        while (existingNumbers.includes(newPatternNum)) {
          newPatternNum++;
        }
      }
      
      const newPatternId = `pattern${newPatternNum}`;
      
      if (state.patterns[newPatternId]) {
        throw new Error(`Pattern ${newPatternNum} already exists`);
      }
      
      const newPattern = createInitialPattern(newPatternNum);
      
      set(draft => {
        draft.patterns[newPatternId] = newPattern;
      });
      
      return newPattern;
    },

    deletePattern: (id: string) => {
      const state = get();
      
      if (Object.keys(state.patterns).length <= 1) {
        return false;
      }
      
      if (state.isPlaying && state.currentPatternId === id) {
        return false;
      }
      
      set(draft => {
        delete draft.patterns[id];
        
        if (draft.currentPatternId === id) {
          const firstPatternId = Object.keys(draft.patterns)[0];
          draft.currentPatternId = firstPatternId;
          const firstPattern = draft.patterns[firstPatternId];
          draft.currentTrackId = Object.keys(firstPattern.tracks)[0];
        }
        
        draft.nextPatternQueue = draft.nextPatternQueue.filter(qId => qId !== id);
      });
      
      return true;
    },

    selectPattern: (id: string) => {
      const state = get();
      if (!state.patterns[id]) return;
      
      set(draft => {
        draft.currentPatternId = id;
        const pattern = draft.patterns[id];
        if (!pattern.tracks[draft.currentTrackId]) {
          draft.currentTrackId = Object.keys(pattern.tracks)[0];
        }
      });
    },

    copyPattern: (sourceId: string) => {
      const state = get();
      const sourcePattern = state.patterns[sourceId];
      if (!sourcePattern) return null;
      
      const existingNumbers = Object.values(state.patterns).map(p => p.patternNumber);
      let newPatternNum = 0;
      while (existingNumbers.includes(newPatternNum)) {
        newPatternNum++;
      }
      
      try {
        const newPattern = JSON.parse(JSON.stringify(sourcePattern)) as Pattern;
        newPattern.id = `pattern${newPatternNum}`;
        newPattern.patternNumber = newPatternNum;
        newPattern.name = `Pattern ${newPatternNum + 1}`;
        
        set(draft => {
          draft.patterns[newPattern.id] = newPattern;
        });
        
        return newPattern;
      } catch (e) {
        console.error('Failed to copy pattern:', e);
        return null;
      }
    },

    queuePattern: (id: string) => {
      set(draft => {
        if (!draft.nextPatternQueue.includes(id)) {
          draft.nextPatternQueue.push(id);
        }
      });
    },

    clearPatternQueue: () => {
      set(draft => {
        draft.nextPatternQueue = [];
      });
    },

    // =========================================================================
    // Track Actions
    // =========================================================================
    
    addTrack: (trackNum?: number) => {
      const state = get();
      const pattern = state.patterns[state.currentPatternId];
      if (!pattern) throw new Error('No current pattern');
      
      let newTrackNum = trackNum ?? -1;
      if (newTrackNum === -1) {
        const existingNumbers = Object.values(pattern.tracks).map(t => t.trackNumber);
        newTrackNum = 0;
        while (existingNumbers.includes(newTrackNum)) {
          newTrackNum++;
        }
      }
      
      const newTrackId = `track${newTrackNum}`;
      
      if (pattern.tracks[newTrackId]) {
        throw new Error(`Track ${newTrackNum} already exists`);
      }
      
      const newTrack = createInitialTrack(newTrackNum);
      
      set(draft => {
        draft.patterns[draft.currentPatternId].tracks[newTrackId] = newTrack;
      });
      
      return newTrack;
    },

    deleteTrack: (id: string) => {
      const state = get();
      const pattern = state.patterns[state.currentPatternId];
      if (!pattern) return false;
      
      if (Object.keys(pattern.tracks).length <= 1) {
        return false;
      }
      
      set(draft => {
        const currentPattern = draft.patterns[draft.currentPatternId];
        delete currentPattern.tracks[id];
        
        if (draft.currentTrackId === id) {
          draft.currentTrackId = Object.keys(currentPattern.tracks)[0];
        }
      });
      
      return true;
    },

    selectTrack: (id: string) => {
      const state = get();
      const pattern = state.patterns[state.currentPatternId];
      if (!pattern?.tracks[id]) return;
      
      set(draft => {
        draft.currentTrackId = id;
      });
    },

    updateTrack: (id: string, updates: Partial<Track>) => {
      const state = get();
      const pattern = state.patterns[state.currentPatternId];
      if (!pattern?.tracks[id]) return;
      
      set(draft => {
        Object.assign(draft.patterns[draft.currentPatternId].tracks[id], updates);
      });
    },

    toggleTrackMute: (id: string) => {
      const state = get();
      const pattern = state.patterns[state.currentPatternId];
      if (!pattern?.tracks[id]) return;
      
      set(draft => {
        const track = draft.patterns[draft.currentPatternId].tracks[id];
        track.muted = !track.muted;
      });
    },

    clearTrack: (id: string) => {
      set(draft => {
        const track = draft.patterns[draft.currentPatternId].tracks[id];
        if (track) {
          track.steps = Array.from({ length: STEPS_PER_PATTERN }, (_, i) => createInitialStep(i));
        }
      });
    },

    // =========================================================================
    // Step Actions
    // =========================================================================
    
    toggleStep: (stepId: string, forceClear?: boolean, noteData?: Pick<Step, 'notePitch' | 'velocity' | 'noteLength'>) => {
      set(draft => {
        const pattern = draft.patterns[draft.currentPatternId];
        const track = pattern?.tracks[draft.currentTrackId];
        if (!track) return;
        
        const stepIndex = track.steps.findIndex(s => s.id === stepId);
        if (stepIndex === -1) return;
        
        const step = track.steps[stepIndex];
        
        if (forceClear || step.enabled) {
          step.enabled = false;
          step.notePitch = undefined;
          step.velocity = undefined;
          step.noteLength = undefined;
        } else {
          step.enabled = true;
          step.notePitch = noteData?.notePitch ?? draft.lastNoteData?.notePitch ?? 60;
          step.velocity = noteData?.velocity ?? draft.lastNoteData?.velocity ?? DEFAULT_VELOCITY;
          step.noteLength = noteData?.noteLength ?? draft.lastNoteData?.noteLength ?? DEFAULT_NOTE_LENGTH;
          
          draft.lastNoteData = {
            notePitch: step.notePitch,
            velocity: step.velocity,
            noteLength: step.noteLength,
          };
        }
      });
    },

    selectStep: (stepId: string | null) => {
      set(draft => {
        draft.selectedStepId = stepId;
      });
    },

    updateStep: (stepId: string, updates: Partial<Step>) => {
      set(draft => {
        const pattern = draft.patterns[draft.currentPatternId];
        const track = pattern?.tracks[draft.currentTrackId];
        if (!track) return;
        
        const step = track.steps.find(s => s.id === stepId);
        if (step) {
          Object.assign(step, updates);
          if (updates.notePitch !== undefined || updates.velocity !== undefined || updates.noteLength !== undefined) {
            draft.lastNoteData = {
              notePitch: step.notePitch ?? draft.lastNoteData?.notePitch,
              velocity: step.velocity ?? draft.lastNoteData?.velocity,
              noteLength: step.noteLength ?? draft.lastNoteData?.noteLength,
            };
          }
        }
      });
    },

    clearAllSteps: () => {
      set(draft => {
        const pattern = draft.patterns[draft.currentPatternId];
        if (!pattern) return;
        
        Object.values(pattern.tracks).forEach(track => {
          track.steps = Array.from({ length: STEPS_PER_PATTERN }, (_, i) => createInitialStep(i));
        });
      });
    },

    // =========================================================================
    // Playback Actions
    // =========================================================================
    
    play: () => {
      set(draft => {
        draft.isPlaying = true;
        draft.activeStepIndex = -1;
      });
    },

    stop: () => {
      set(draft => {
        draft.isPlaying = false;
        draft.activeStepIndex = null;
        draft.nextPatternQueue = [];
      });
    },

    setBpm: (bpm: number) => {
      if (bpm > 0 && bpm < 999) {
        set(draft => {
          draft.bpm = bpm;
        });
      }
    },

    setSwing: (swing: number) => {
      if (swing >= 0 && swing <= 75) {
        set(draft => {
          draft.swing = swing;
        });
      }
    },

    setActiveStep: (index: number | null) => {
      set(draft => {
        draft.activeStepIndex = index;
      });
    },

    advanceStep: () => {
      set(draft => {
        if (!draft.isPlaying) return;
        
        const currentIndex = draft.activeStepIndex ?? -1;
        const nextIndex = (currentIndex + 1) % STEPS_PER_PATTERN;
        
        // Pattern switching at end
        if (nextIndex === 0 && draft.nextPatternQueue.length > 0) {
          const nextPatternId = draft.nextPatternQueue.shift()!;
          if (draft.patterns[nextPatternId]) {
            draft.currentPatternId = nextPatternId;
            const pattern = draft.patterns[nextPatternId];
            if (!pattern.tracks[draft.currentTrackId]) {
              draft.currentTrackId = Object.keys(pattern.tracks)[0];
            }
          }
        }
        
        draft.activeStepIndex = nextIndex;
      });
    },

    // =========================================================================
    // MIDI Actions
    // =========================================================================
    
    setMidiDevices: (inputs: MIDIDevice[], outputs: MIDIDevice[]) => {
      set(draft => {
        draft.midiInputDevices = inputs;
        draft.midiOutputDevices = outputs;
        
        // Auto-select first input if none selected
        if (!draft.selectedInputDeviceId && inputs.length > 0) {
          draft.selectedInputDeviceId = inputs[0].id;
          
          // Try to find matching output for LED control
          const matchingOutput = outputs.find(out => out.name === inputs[0].name);
          draft.ledTargetDeviceId = matchingOutput?.id;
        }
      });
    },

    selectInputDevice: (id: string | undefined) => {
      set(draft => {
        draft.selectedInputDeviceId = id;
        
        if (id) {
          const selectedInput = draft.midiInputDevices.find(d => d.id === id);
          const matchingOutput = draft.midiOutputDevices.find(out => out.name === selectedInput?.name);
          draft.ledTargetDeviceId = matchingOutput?.id;
        } else {
          draft.ledTargetDeviceId = undefined;
        }
      });
    },

    toggleMidiLearn: () => {
      set(draft => {
        draft.midiLearnActive = !draft.midiLearnActive;
        draft.lastLearnedControl = null;
      });
    },

    setLastLearnedControl: (cc: number | null) => {
      set(draft => {
        draft.lastLearnedControl = cc;
      });
    },

    saveMidiAssignments: (assignments: MidiAssignments) => {
      set(draft => {
        // Filter and store assignments
        draft.midiAssignments = Object.entries(assignments).reduce((acc, [key, value]) => {
          if (typeof value === 'number' && !isNaN(value)) {
            acc[key] = value;
          }
          return acc;
        }, {} as Record<string, number>);
        
        // Derive ledOrder from step assignments
        draft.ledOrder = Object.entries(assignments)
          .filter(([key, value]) => key.startsWith('setup_step') && typeof value === 'number')
          .sort(([a], [b]) => parseInt(a.replace('setup_step', '')) - parseInt(b.replace('setup_step', '')))
          .map(([, value]) => value);
        
        // Derive trackSelectors from track assignments
        draft.trackSelectors = Object.entries(assignments)
          .filter(([key, value]) => key.startsWith('setup_track') && typeof value === 'number')
          .sort(([a], [b]) => parseInt(a.replace('setup_track', '')) - parseInt(b.replace('setup_track', '')))
          .map(([, value]) => value);
        
        draft.midiLearnActive = false;
      });
    },

    // =========================================================================
    // UI Actions
    // =========================================================================
    
    setChangePatternMode: (active: boolean) => {
      set(draft => {
        draft.changePatternMode = active;
      });
    },

    setPasteActive: (active: boolean) => {
      set(draft => {
        draft.pasteActive = active;
      });
    },

    setTransposeMode: (active: boolean) => {
      set(draft => {
        draft.transposeModeActive = active;
      });
    },

    setTransposeValue: (value: number) => {
      set(draft => {
        draft.currentTransposeValue = value;
      });
    },

    // =========================================================================
    // Persistence
    // =========================================================================
    
    loadState: (state: Partial<SequencerStoreState>) => {
      set(draft => {
        // Merge loaded state with defaults, preserving runtime state
        const runtimeState = {
          midiInputDevices: draft.midiInputDevices,
          midiOutputDevices: draft.midiOutputDevices,
          isPlaying: false,
          activeStepIndex: null,
          lastLearnedControl: null,
          midiLearnActive: false,
        };
        
        Object.assign(draft, createInitialState(), state, runtimeState);
        
        // Validate current IDs
        if (!draft.patterns[draft.currentPatternId]) {
          draft.currentPatternId = Object.keys(draft.patterns)[0];
        }
        const pattern = draft.patterns[draft.currentPatternId];
        if (!pattern?.tracks[draft.currentTrackId]) {
          draft.currentTrackId = Object.keys(pattern.tracks)[0];
        }
      });
    },

    resetState: () => {
      set(createInitialState());
    },
  }))
);

// ============================================================================
// Selectors (for derived state)
// ============================================================================

export const selectCurrentPattern = (state: SequencerStoreState) => 
  state.patterns[state.currentPatternId];

export const selectCurrentTrack = (state: SequencerStoreState) => {
  const pattern = state.patterns[state.currentPatternId];
  return pattern?.tracks[state.currentTrackId];
};

export const selectPatternList = (state: SequencerStoreState) =>
  Object.values(state.patterns).sort((a, b) => a.patternNumber - b.patternNumber);

export const selectTrackList = (state: SequencerStoreState) => {
  const pattern = state.patterns[state.currentPatternId];
  return Object.values(pattern?.tracks ?? {}).sort((a, b) => a.trackNumber - b.trackNumber);
};

export default useSequencerStore;
