/**
 * useMIDIController Hook - Manages MIDI control surface integration
 * 
 * Handles:
 * - MIDI device initialization and monitoring
 * - MIDI learn mode
 * - Control assignments
 * - LED feedback
 * - Real-time control messages
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSequencerStore, selectCurrentPattern, selectCurrentTrack } from '@/stores/sequencerStore';
import { midiService } from '@/services/midiService';
import { persistenceService } from '@/services/persistenceService';
import type { Step, MIDIMessageEvent, MidiAssignments } from '@/types/sequencer';

// MIDI command constants
const CMD_NOTE_ON = 0x9;
const CMD_CONTROL_CHANGE = 0xB;

export function useMIDIController() {
  const store = useSequencerStore();
  const currentPattern = useSequencerStore(selectCurrentPattern);
  const currentTrack = useSequencerStore(selectCurrentTrack);
  
  // Refs for latest state in callbacks
  const stateRef = useRef(store);
  stateRef.current = store;
  
  const patternRef = useRef(currentPattern);
  patternRef.current = currentPattern;
  
  const trackRef = useRef(currentTrack);
  trackRef.current = currentTrack;

  // Initialize MIDI
  useEffect(() => {
    // Skip MIDI initialization on server or if not supported
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      return;
    }

    const init = async () => {
      const result = await midiService.initialize();
      
      if (result.success) {
        // Initial device scan
        updateDeviceList();
      } else {
        // Only log error, don't throw - MIDI is optional
        console.warn('MIDI not available:', result.error?.message);
      }
    };

    init();
  }, []);

  // Update device list
  const updateDeviceList = useCallback(() => {
    const inputs = midiService.getInputs();
    const outputs = midiService.getOutputs();
    store.setMidiDevices(inputs, outputs);
  }, [store]);

  // Handle incoming MIDI messages
  const handleMIDIMessage = useCallback((event: MIDIMessageEvent) => {
    const state = stateRef.current;
    
    // Filter by selected device
    if (state.selectedInputDeviceId && event.srcElement.id !== state.selectedInputDeviceId) {
      return;
    }

    const data = event.data;
    const command = data[0] >> 4;
    const channel = data[0] & 0x0f;
    const noteOrCC = data[1];
    const value = data[2];

    // MIDI Learn mode
    if (state.midiLearnActive) {
      if (command === CMD_CONTROL_CHANGE || (command === CMD_NOTE_ON && value > 0)) {
        store.setLastLearnedControl(noteOrCC);
      }
      return;
    }

    // Find assignment for this CC
    const findAssignment = (cc: number): string | undefined => {
      return Object.entries(state.midiAssignments).find(([, val]) => val === cc)?.[0];
    };

    // Handle Control Change messages
    if (command === CMD_CONTROL_CHANGE) {
      const assignment = findAssignment(noteOrCC);
      if (assignment) {
        handleControlAssignment(assignment, value);
      }
    }

    // Handle Note On messages (for external keyboard input)
    if (command === CMD_NOTE_ON && value > 0) {
      handleNoteInput(noteOrCC, value);
    }
  }, [store]);

  // Handle control assignments
  const handleControlAssignment = useCallback((assignment: string, value: number) => {
    const state = stateRef.current;
    const track = trackRef.current;
    
    switch (assignment) {
      case 'setup_play':
        if (value > 0) state.play();
        break;
        
      case 'setup_stop':
        if (value > 0) state.stop();
        break;
        
      case 'setup_tempo':
        const newBpm = Math.round((value / 127) * (300 - 60)) + 60;
        state.setBpm(newBpm);
        break;
        
      case 'setup_swing':
        const newSwing = Math.round((value / 127) * 75);
        state.setSwing(newSwing);
        break;
        
      case 'setup_pattern':
        state.setChangePatternMode(value > 0);
        break;
        
      case 'setup_copy':
        state.setPasteActive(value > 0);
        break;
        
      case 'setup_clear':
        if (value > 0) {
          if (state.selectedStepId) {
            store.toggleStep(state.selectedStepId, true);
          } else if (state.pasteActive) {
            store.clearAllSteps();
          } else if (track) {
            store.clearTrack(track.id);
          }
        }
        break;
        
      case 'setup_notepitch':
        updateStepParameter('notePitch', value);
        break;
        
      case 'setup_velocity':
        updateStepParameter('velocity', value);
        break;
        
      case 'setup_notelength':
        const length = Math.max(1, Math.min(16, Math.round((value / 127) * 15) + 1));
        updateStepParameter('noteLength', length);
        break;
        
      default:
        // Handle step buttons
        if (assignment.startsWith('setup_step')) {
          const stepIndex = parseInt(assignment.replace('setup_step', ''), 10) - 1;
          if (stepIndex >= 0 && stepIndex < 16 && track) {
            const stepId = track.steps[stepIndex]?.id;
            if (stepId) {
              if (value > 0) {
                store.selectStep(stepId);
                if (state.pasteActive && state.lastNoteData) {
                  store.toggleStep(stepId, false, state.lastNoteData);
                }
              }
            }
          }
        }
        
        // Handle track/pattern buttons
        if (assignment.startsWith('setup_track')) {
          const index = parseInt(assignment.replace('setup_track', ''), 10) - 1;
          if (index >= 0) {
            if (value > 0) {
              if (state.changePatternMode) {
                // Pattern selection mode
                const patternId = `pattern${index}`;
                if (state.patterns[patternId]) {
                  store.selectPattern(patternId);
                }
              } else {
                // Track selection mode
                const trackId = `track${index}`;
                const pattern = patternRef.current;
                if (pattern?.tracks[trackId]) {
                  if (state.pasteActive) {
                    store.toggleTrackMute(trackId);
                  } else {
                    store.selectTrack(trackId);
                  }
                } else {
                  store.addTrack(index);
                }
              }
            }
          }
        }
    }
  }, [store]);

  // Update step parameter
  const updateStepParameter = useCallback((param: keyof Step, value: number) => {
    const state = stateRef.current;
    
    if (state.selectedStepId) {
      store.updateStep(state.selectedStepId, { [param]: value, enabled: true });
    } else if (state.pasteActive) {
      store.updateStep('', { [param]: value });
    }
  }, [store]);

  // Handle note input from external keyboard
  const handleNoteInput = useCallback((pitch: number, velocity: number) => {
    const state = stateRef.current;
    const track = trackRef.current;
    
    if (state.selectedStepId && track) {
      store.updateStep(state.selectedStepId, {
        notePitch: pitch,
        velocity,
        enabled: true,
        noteLength: track.steps.find(s => s.id === state.selectedStepId)?.noteLength ?? 1,
      });
    }
  }, [store]);

  // Subscribe to MIDI messages
  useEffect(() => {
    const unsubscribe = midiService.onMessage(handleMIDIMessage);
    return unsubscribe;
  }, [handleMIDIMessage]);

  // Update control LEDs when state changes
  useEffect(() => {
    if (!store.ledTargetDeviceId || store.trackSelectors.length === 0) return;

    const pattern = patternRef.current;
    const track = trackRef.current;
    
    midiService.updateControlLEDs(store.ledTargetDeviceId, {
      trackSelectors: store.trackSelectors,
      patternCC: store.midiAssignments['setup_pattern'],
      currentTrackIndex: track?.trackNumber ?? -1,
      currentPatternIndex: pattern?.patternNumber ?? -1,
      isPatternMode: store.changePatternMode,
    });
  }, [
    store.ledTargetDeviceId,
    store.trackSelectors,
    store.midiAssignments,
    store.changePatternMode,
    currentPattern?.patternNumber,
    currentTrack?.trackNumber,
  ]);

  // Actions
  const selectInputDevice = useCallback((deviceId: string | undefined) => {
    store.selectInputDevice(deviceId);
  }, [store]);

  const toggleMidiLearn = useCallback(() => {
    store.toggleMidiLearn();
  }, [store]);

  const saveMidiAssignments = useCallback((assignments: MidiAssignments) => {
    store.saveMidiAssignments(assignments);
    // Also save to persistence
    persistenceService.saveDebounced(store);
  }, [store]);

  return {
    // State
    inputDevices: store.midiInputDevices,
    outputDevices: store.midiOutputDevices,
    selectedInputDeviceId: store.selectedInputDeviceId,
    ledTargetDeviceId: store.ledTargetDeviceId,
    midiLearnActive: store.midiLearnActive,
    lastLearnedControl: store.lastLearnedControl,
    midiAssignments: store.midiAssignments,
    
    // Actions
    selectInputDevice,
    toggleMidiLearn,
    saveMidiAssignments,
    refreshDevices: updateDeviceList,
  };
}

export default useMIDIController;
