
export interface Step {
  id: string; // e.g., "b01", "b16"
  notePitch?: number; // MIDI note number (0-127)
  velocity?: number; // MIDI velocity (0-127)
  noteLength?: number; // Duration in steps (e.g., 1 for a single step)
  noteOff?: number; // Note pitch to turn off at the beginning of this step (legacy from original code, might refactor)
  active?: boolean; // Is the step currently playing?
  selected?: boolean; // Is the step selected for editing?
  enabled?: boolean; // Is there a note programmed on this step?
}

export interface Track {
  id: string; // e.g., "track0", "track1"
  trackNumber: number;
  name: string; // e.g., "Track 1"
  steps: Step[];
  outputDeviceId?: string;
  midiChannel: string; // e.g., "0000" for channel 1
  muted: boolean;
  transpose: number; // Transposition value
}

export interface Pattern {
  id: string; // e.g., "pattern0", "pattern1"
  patternNumber: number;
  name: string; // e.g., "Pattern 1"
  tracks: { [trackId: string]: Track };
}

export interface MIDIDevice {
  id: string;
  name: string;
  type: 'input' | 'output';
}

export interface SequencerState {
  patterns: { [patternId: string]: Pattern };
  currentPatternId: string;
  nextPatternQueue: string[];
  currentTrackId: string;
  activeStepIndex: number | null; // 0-15 or null if stopped
  selectedStepId: string | null; // ID of the step selected for editing
  bpm: number;
  swing: number; // 0-100
  isPlaying: boolean;
  midiInputDevices: MIDIDevice[];
  midiOutputDevices: MIDIDevice[];
  selectedInputDeviceId?: string;
  ledTargetDeviceId?: string; // For controllers with LEDs
  midiLearnActive: boolean;
  lastLearnedControl: number | null; // Store last MIDI CC learned
  midiAssignments: { [key: string]: number }; // Map control name (e.g., "setup_play") to MIDI CC number
  ledOrder: number[]; // Map step index (0-15) to LED CC number
  trackSelectors: number[]; // MIDI CC numbers for selecting tracks
  changePatternMode: boolean; // Is pattern select/create mode active?
  pasteActive: boolean; // Is paste mode active?
  lastNoteData?: Pick<Step, 'notePitch' | 'velocity' | 'noteLength'>; // For copy/paste
  transposeModeActive: boolean; // Is transpose mode active for the current track/pattern?
  currentTransposeValue: number;
}

export interface MIDIMessageEvent {
  data: Uint8Array;
  receivedTime: number;
  srcElement: { id: string }; // Simplified from original code
}

// MIDI CC assignments based on original code's local storage structure
export interface MidiAssignments {
  setup_step1?: number;
  setup_step2?: number;
  setup_step3?: number;
  setup_step4?: number;
  setup_step5?: number;
  setup_step6?: number;
  setup_step7?: number;
  setup_step8?: number;
  setup_step9?: number;
  setup_step10?: number;
  setup_step11?: number;
  setup_step12?: number;
  setup_step13?: number;
  setup_step14?: number;
  setup_step15?: number;
  setup_step16?: number;
  setup_track1?: number;
  setup_track2?: number;
  setup_track3?: number;
  setup_track4?: number;
  setup_track5?: number;
  setup_track6?: number;
  setup_track7?: number;
  setup_track8?: number;
  setup_notepitch?: number;
  setup_velocity?: number;
  setup_notelength?: number;
  setup_notefill?: number; // Added based on usage
  setup_play?: number;
  setup_stop?: number;
  setup_tempo?: number;
  setup_swing?: number;
  setup_copy?: number; // Paste button in original code
  setup_clear?: number;
  setup_pattern?: number; // Pattern select/create button
  // Add other potential assignments if needed
}
