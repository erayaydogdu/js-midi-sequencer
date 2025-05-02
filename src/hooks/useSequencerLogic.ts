
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SequencerState, Pattern, Track, Step, MIDIMessageEvent, MIDIDevice, MidiAssignments } from '@/types/sequencer';
import { useMIDI } from './useMIDI';
import { toast } from "@/hooks/use-toast"; // Assuming useToast hook is available

const DEFAULT_BPM = 120;
const DEFAULT_SWING = 0;
const STEPS_PER_PATTERN = 16;
const DEFAULT_VELOCITY = 100;
const DEFAULT_NOTE_LENGTH = 1;

// Helper to create initial state
const createInitialStep = (index: number): Step => ({
  id: `b${(index + 1).toString().padStart(2, '0')}`,
  enabled: false,
});

const createInitialTrack = (trackNumber: number): Track => ({
  id: `track${trackNumber}`,
  trackNumber,
  name: `Track ${trackNumber + 1}`,
  steps: Array.from({ length: STEPS_PER_PATTERN }, (_, i) => createInitialStep(i)),
  midiChannel: trackNumber.toString(16).padStart(4, '0'), // Assign channels sequentially initially
  muted: false,
  outputDeviceId: undefined,
  transpose: 0,
});

const createInitialPattern = (patternNumber: number): Pattern => ({
  id: `pattern${patternNumber}`,
  patternNumber,
  name: `Pattern ${patternNumber + 1}`,
  tracks: { 'track0': createInitialTrack(0) }, // Start with one track
});


// --- Main Hook ---
export function useSequencerLogic() {
    const [sequencerState, setSequencerState] = useState<SequencerState>(() => {
       // Load initial state potentially from localStorage or defaults
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
             ledOrder: [], // Initialize empty, expect setup from MIDI learn/storage
             trackSelectors: [], // Initialize empty
             changePatternMode: false,
             pasteActive: false,
             lastNoteData: undefined,
             transposeModeActive: false,
             currentTransposeValue: 0,
       };
    });

  const timerWorkerRef = useRef<Worker | null>(null);
  const currentStepRef = useRef<number>(0); // Keep track of the absolute step
  const midiOutputsRef = useRef<{ [trackId: string]: MIDIOutput | undefined }>({}); // Cache MIDI output ports

  // --- MIDI Integration ---
   const handleMIDIMessage = useCallback((event: MIDIMessageEvent) => {
     // console.log('MIDI Message in Logic:', event.data, 'from:', event.srcElement.id);
      setSequencerState(prevState => {
          // Only process messages from the selected input device
          if (prevState.selectedInputDeviceId && event.srcElement.id !== prevState.selectedInputDeviceId) {
            // console.log(`Ignoring message from unselected device: ${event.srcElement.id}`);
            return prevState;
          }

          const data = event.data;
          const command = data[0] >> 4; // Get the command type (e.g., 9 for Note On, 8 for Note Off, B for CC)
          const channel = data[0] & 0x0f; // Get the MIDI channel (0-15)
          const noteOrCC = data[1];
          const velocityOrValue = data[2];

         if (prevState.midiLearnActive) {
              // Only learn from Control Change (B) or Note On (9) messages with velocity > 0 for buttons
              if (command === 0xB || (command === 0x9 && velocityOrValue > 0)) {
                console.log(`MIDI Learn: Detected CC ${noteOrCC} with value ${velocityOrValue}`);
                // Prevent immediate re-triggering of the same control
                 if(prevState.lastLearnedControl !== noteOrCC){
                      return { ...prevState, lastLearnedControl: noteOrCC };
                 }
              }
               return prevState; // No state change if not a learnable message or same as last
          }

          // --- Handle Assigned MIDI Controls ---
          const assignments = prevState.midiAssignments;
          const currentPattern = prevState.patterns[prevState.currentPatternId];
          const currentTrack = currentPattern?.tracks[prevState.currentTrackId];

           // Helper to find assignment key by CC value
          const findAssignment = (cc: number): keyof MidiAssignments | undefined => {
            return Object.entries(assignments).find(([, value]) => value === cc)?.[0] as keyof MidiAssignments | undefined;
          };

          if (command === 0xB) { // Control Change
             const assignmentKey = findAssignment(noteOrCC);
              // console.log(`CC ${noteOrCC} received, maps to: ${assignmentKey}, value: ${velocityOrValue}`);

             switch (assignmentKey) {
                 case 'setup_play':
                     if (velocityOrValue > 0) handlePlay();
                     break;
                 case 'setup_stop':
                     if (velocityOrValue > 0) handleStop();
                     break;
                 case 'setup_tempo':
                      const newBpm = Math.round((velocityOrValue / 127) * 240) + 60; // Example mapping (60-300 BPM)
                      handleBpmChange(newBpm);
                      break;
                 case 'setup_swing':
                      const newSwing = Math.round((velocityOrValue / 127) * 75); // 0-75% swing
                      handleSwingChange(newSwing);
                      break;
                 case 'setup_pattern':
                      return { ...prevState, changePatternMode: velocityOrValue > 0 };
                  case 'setup_copy':
                      return { ...prevState, pasteActive: velocityOrValue > 0 };
                  case 'setup_clear':
                      if (velocityOrValue > 0 && prevState.selectedStepId) {
                          // Clear selected step or whole track/pattern based on paste mode
                          // Simplified: Clear selected step if any
                           handleStepToggle(prevState.selectedStepId, true); // Force clear
                      } else if (velocityOrValue > 0 && !prevState.selectedStepId && prevState.pasteActive) {
                          // Clear whole pattern if paste is active and no step selected
                          clearPattern(prevState.currentPatternId);
                      } else if (velocityOrValue > 0 && !prevState.selectedStepId && !prevState.pasteActive) {
                           // Clear current track if paste is not active and no step selected
                           clearTrack(prevState.currentPatternId, prevState.currentTrackId);
                      }
                      break;
                  // --- Step/Track Selectors ---
                  default:
                      if (assignmentKey?.startsWith('setup_step')) {
                         const stepIndex = parseInt(assignmentKey.replace('setup_step', ''), 10) - 1;
                         if (stepIndex >= 0 && stepIndex < STEPS_PER_PATTERN) {
                              const stepId = `b${(stepIndex + 1).toString().padStart(2, '0')}`;
                              if (velocityOrValue > 0) { // Button Press
                                  handleStepSelect(stepId);
                                  // If paste active, apply last note
                                  if(prevState.pasteActive && prevState.lastNoteData){
                                       handleStepToggle(stepId, false, prevState.lastNoteData);
                                  }
                              } else { // Button Release
                                  // Deselect maybe? Or handle length change end?
                                  // For simplicity, maybe only act on press for now
                              }
                          }
                      } else if (assignmentKey?.startsWith('setup_track')) {
                         const trackOrPatternIndex = parseInt(assignmentKey.replace('setup_track', ''), 10) - 1;
                         const isPatternMode = prevState.changePatternMode;

                         if (velocityOrValue > 0) { // Button Press
                            if (isPatternMode) {
                                const patternId = `pattern${trackOrPatternIndex}`;
                                if (prevState.patterns[patternId]) {
                                    handlePatternSelect(patternId);
                                } else {
                                    // Create new pattern if it doesn't exist (maybe prompt?)
                                    console.log(`Attempted to select non-existent pattern ${trackOrPatternIndex + 1}`);
                                    // handleAddPattern(trackOrPatternIndex); // Optionally create on select
                                }
                            } else { // Track Mode
                                const trackId = `track${trackOrPatternIndex}`;
                                if (currentPattern?.tracks[trackId]) {
                                    if (prevState.pasteActive) { // Mute toggle in paste mode
                                        toggleTrackMute(currentPattern.id, trackId);
                                    } else {
                                        handleTrackSelect(trackId);
                                    }
                                } else {
                                    // Create new track
                                     handleAddTrack(trackOrPatternIndex);
                                     handleTrackSelect(`track${trackOrPatternIndex}`);
                                }
                            }
                        } else { // Button Release
                            // Reset flags maybe?
                             if (!isPatternMode) {
                                 // reset transpose mode if active?
                             }
                         }
                     }
                 // --- Note Parameter Controls (apply to selected step) ---
                      else if (prevState.selectedStepId) {
                          const currentStep = currentTrack?.steps.find(s => s.id === prevState.selectedStepId);
                          if (currentStep) {
                               let changes: Partial<Step> = {};
                               switch (assignmentKey) {
                                   case 'setup_notepitch':
                                        changes = { notePitch: noteOrCC, enabled: noteOrCC > 0, velocity: currentStep.velocity ?? DEFAULT_VELOCITY, noteLength: currentStep.noteLength ?? DEFAULT_NOTE_LENGTH };
                                       // Also store for paste
                                       setSequencerState(prev => ({...prev, lastNoteData: {notePitch: changes.notePitch, velocity: changes.velocity, noteLength: changes.noteLength}}));
                                       break;
                                   case 'setup_velocity':
                                       changes = { velocity: velocityOrValue };
                                       // Also store for paste
                                        setSequencerState(prev => ({...prev, lastNoteData: {...prev.lastNoteData, velocity: changes.velocity }}));
                                       break;
                                    case 'setup_notelength':
                                        // Map 0-127 to 1-16 steps (adjust mapping as needed)
                                        const length = Math.max(1, Math.min(STEPS_PER_PATTERN, Math.round((velocityOrValue / 127) * (STEPS_PER_PATTERN -1)) + 1));
                                        changes = { noteLength: length };
                                        // Also store for paste
                                        setSequencerState(prev => ({...prev, lastNoteData: {...prev.lastNoteData, noteLength: changes.noteLength }}));
                                        break;
                                    // 'setup_notefill' - needs more complex logic, maybe handle outside direct state update
                               }
                                if (Object.keys(changes).length > 0) {
                                   updateStep(prevState.currentPatternId, prevState.currentTrackId, prevState.selectedStepId, changes);
                               }
                          }
                      }
                 break;
             } // end switch
          } else if (command === 0x9 && velocityOrValue > 0) { // Note On (from external keyboard potentially)
              // If a step is selected, apply the played note to it
              if (prevState.selectedStepId && currentTrack) {
                  const notePitch = noteOrCC;
                  const velocity = velocityOrValue;
                   const currentStep = currentTrack.steps.find(s => s.id === prevState.selectedStepId);
                   const changes: Partial<Step> = {
                       notePitch,
                       velocity,
                       enabled: true,
                       noteLength: currentStep?.noteLength ?? DEFAULT_NOTE_LENGTH, // Keep existing or default length
                   };
                   updateStep(prevState.currentPatternId, prevState.currentTrackId, prevState.selectedStepId, changes);
                    // Also store for paste
                   setSequencerState(prev => ({...prev, lastNoteData: {notePitch: changes.notePitch, velocity: changes.velocity, noteLength: changes.noteLength}}));

              }
          }
         // No need to return explicitly if modifying via setters
         return prevState; // Return previous state if no changes handled by setters
     });

   }, []); // Dependencies will be managed inside or passed if needed

  const { midiAccess, inputDevices, outputDevices, sendMIDI, getOutputPortById, error: midiError } = useMIDI({ onMessage: handleMIDIMessage });

   // Update device lists in state when useMIDI provides them
   useEffect(() => {
    setSequencerState(prev => ({
        ...prev,
        midiInputDevices: inputDevices,
        midiOutputDevices: outputDevices,
        // Auto-select first device if none selected?
         selectedInputDeviceId: prev.selectedInputDeviceId ?? inputDevices[0]?.id,
        // Try to find LED target based on input device name (like original code)
         ledTargetDeviceId: prev.ledTargetDeviceId ?? outputDevices.find(out => out.name === inputDevices.find(inp => inp.id === (prev.selectedInputDeviceId ?? inputDevices[0]?.id))?.name)?.id,
    }));

     // Update MIDI output cache
     const newOutputsCache: { [trackId: string]: MIDIOutput | undefined } = {};
     Object.values(sequencerState.patterns).forEach(pattern => {
       Object.values(pattern.tracks).forEach(track => {
         if (track.outputDeviceId) {
           newOutputsCache[track.id] = getOutputPortById(track.outputDeviceId);
         }
       });
     });
     midiOutputsRef.current = newOutputsCache;


  }, [inputDevices, outputDevices, getOutputPortById, sequencerState.patterns, sequencerState.selectedInputDeviceId ]); // Add deps


   // --- Load/Save State (Example using localStorage) ---
   useEffect(() => {
     const savedState = localStorage.getItem('sequencerState');
     if (savedState) {
       try {
         const parsedState = JSON.parse(savedState) as Partial<SequencerState>;
          // Merge saved state with initial defaults carefully
         setSequencerState(prev => ({
            ...prev, // Start with initial defaults
            ...parsedState, // Overwrite with saved values
             midiInputDevices: prev.midiInputDevices, // Keep current devices
             midiOutputDevices: prev.midiOutputDevices, // Keep current devices
             isPlaying: false, // Always start stopped
             activeStepIndex: null,
             lastLearnedControl: null, // Don't persist temporary learn state
             // Ensure patterns and tracks structure is valid after loading
             patterns: parsedState.patterns || prev.patterns,
             currentPatternId: parsedState.currentPatternId || prev.currentPatternId,
             currentTrackId: parsedState.currentTrackId || prev.currentTrackId,
             // Ensure essential assignments are numbers
              midiAssignments: Object.entries(parsedState.midiAssignments || {}).reduce((acc, [key, value]) => {
                 acc[key as keyof MidiAssignments] = typeof value === 'number' ? value : undefined;
                 return acc;
             }, {} as MidiAssignments),
              // Load ledOrder and trackSelectors, ensure they are arrays of numbers
              ledOrder: Array.isArray(parsedState.ledOrder) ? parsedState.ledOrder.filter(n => typeof n === 'number') : [],
              trackSelectors: Array.isArray(parsedState.trackSelectors) ? parsedState.trackSelectors.filter(n => typeof n === 'number') : [],
         }));
         console.log("Sequencer state loaded from localStorage.");
       } catch (e) {
         console.error("Failed to parse saved sequencer state:", e);
         localStorage.removeItem('sequencerState'); // Clear invalid state
       }
     }
      // Load MIDI assignments separately if stored differently
     const savedAssignments = localStorage.getItem('midiAssignments'); // From original code's storage key
      if (savedAssignments && !savedState) { // Only load if full state wasn't loaded
          try {
              const parsedAssignments = JSON.parse(savedAssignments);
               setSequencerState(prev => ({
                    ...prev,
                    midiAssignments: parsedAssignments,
                    // Populate ledOrder and trackSelectors from loaded assignments
                    ledOrder: Object.entries(parsedAssignments)
                            .filter(([key]) => key.startsWith('setup_step'))
                            .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_step','')) - parseInt(keyB.replace('setup_step','')))
                            .map(([, value]) => value as number),
                    trackSelectors: Object.entries(parsedAssignments)
                            .filter(([key]) => key.startsWith('setup_track'))
                            .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_track','')) - parseInt(keyB.replace('setup_track','')))
                            .map(([, value]) => value as number),
               }));
               console.log("MIDI assignments loaded from legacy localStorage.");
          } catch(e) {
              console.error("Failed to parse legacy MIDI assignments:", e);
              localStorage.removeItem('midiAssignments');
          }
      }


   }, []); // Load once on mount

   useEffect(() => {
     // Save state whenever it changes (debounce might be good here for performance)
      const stateToSave = { ...sequencerState };
      // Avoid saving transient state
      delete stateToSave.midiInputDevices;
      delete stateToSave.midiOutputDevices;
      delete stateToSave.lastLearnedControl;
      delete stateToSave.activeStepIndex;
      delete stateToSave.isPlaying; // Or save as default false

     localStorage.setItem('sequencerState', JSON.stringify(stateToSave));
     // Also save legacy assignments if needed
      localStorage.setItem('midiAssignments', JSON.stringify(sequencerState.midiAssignments));
   }, [sequencerState]);


  // --- Web Worker Timer ---
  useEffect(() => {
    timerWorkerRef.current = new Worker(new URL('../workers/timerWorker.ts', import.meta.url));

    timerWorkerRef.current.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'tick') {
        // console.log("Tick received:", e.data.step);
        setSequencerState(prev => {
            if (!prev.isPlaying) return prev;

            const currentPatternId = prev.patterns[prev.currentPatternId]
                ? prev.currentPatternId
                : Object.keys(prev.patterns)[0] || null; // Fallback if current pattern deleted

            if (!currentPatternId) return prev; // No patterns left

            const newActiveStepIndex = e.data.step; // 0-15
            playStep(newActiveStepIndex, prev); // Pass full state to playStep


             // Switch pattern at the end of the sequence if queue is not empty
             let nextPatternId = currentPatternId;
             let nextQueue = [...prev.nextPatternQueue];
             if (newActiveStepIndex === STEPS_PER_PATTERN - 1 && nextQueue.length > 0) {
                nextPatternId = nextQueue.shift()!; // Take the first pattern from the queue
                // Send All Notes Off / Sound Off CC 120/123 when switching?
                 allNotesOff(prev, true); // Send All Notes Off for all tracks on pattern switch
                 console.log(`Switching to pattern: ${nextPatternId}`);
             }


            return {
                ...prev,
                activeStepIndex: newActiveStepIndex,
                currentPatternId: nextPatternId, // Update current pattern if switched
                nextPatternQueue: nextQueue,
            };
        });
      }
    };

     // Send initial BPM and Swing
     timerWorkerRef.current.postMessage({ cmd: 'bpm', value: sequencerState.bpm });
     timerWorkerRef.current.postMessage({ cmd: 'swing', value: sequencerState.swing });


    return () => {
      console.log("Terminating timer worker");
      timerWorkerRef.current?.terminate();
      timerWorkerRef.current = null;
      // Ensure All Notes Off when component unmounts if playing
      if (sequencerState.isPlaying) {
        allNotesOff(sequencerState, false);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Initialize worker once

  // --- Playback Logic ---
   const playStep = (stepIndex: number, state: SequencerState) => {
       const pattern = state.patterns[state.currentPatternId];
       if (!pattern) return;

       // --- LED Feedback ---
       sendLedUpdate(stepIndex, state.ledOrder, state.ledTargetDeviceId);

       // --- Note On/Off Logic ---
       Object.values(pattern.tracks).forEach(track => {
           if (track.muted) return;

           const step = track.steps[stepIndex];
           const output = midiOutputsRef.current[track.id]; // Use cached output port
           const midiChannel = parseInt(track.midiChannel, 16); // Parse channel string

           if (!output || isNaN(midiChannel) || midiChannel < 0 || midiChannel > 15) return;

           const noteOnCmd = 0x90 | midiChannel;
           const noteOffCmd = 0x80 | midiChannel;
           const currentTranspose = track.transpose || 0;

           // --- Handle Note Offs scheduled for this step ---
            // Check all steps in the track for notes ending now
            track.steps.forEach((s, s_idx) => {
                 if(s.enabled && s.notePitch !== undefined && s.noteLength !== undefined){
                    const noteEndStep = (s_idx + s.noteLength) % STEPS_PER_PATTERN;
                     if(noteEndStep === stepIndex){
                        const offPitch = s.notePitch + currentTranspose;
                         if (offPitch >= 0 && offPitch <= 127) {
                            // console.log(`Track ${track.trackNumber} Step ${stepIndex}: Note OFF ${offPitch}`);
                             sendMIDI(track.outputDeviceId!, [noteOffCmd, offPitch, 0]); // Velocity 0 often means Note Off
                         }
                    }
                 }
            });


           // --- Handle Note Ons for this step ---
           if (step.enabled && step.notePitch !== undefined) {
               const pitch = step.notePitch + currentTranspose;
               const velocity = step.velocity ?? DEFAULT_VELOCITY;
                if (pitch >= 0 && pitch <= 127) {
                     // console.log(`Track ${track.trackNumber} Step ${stepIndex}: Note ON ${pitch} Vel ${velocity}`);
                    sendMIDI(track.outputDeviceId!, [noteOnCmd, pitch, velocity]);

                     // Schedule Note Off based on length (handled above now)
                }
           }
       });
   };


  // Send All Notes Off for all tracks or specific context
  const allNotesOff = (state: SequencerState, isPatternSwitch: boolean = false) => {
     console.log("Sending All Notes Off / All Sound Off");
     Object.values(state.patterns).forEach(pattern => { // Iterate through all patterns or just current?
        Object.values(pattern.tracks).forEach(track => {
            const output = midiOutputsRef.current[track.id];
            const deviceId = track.outputDeviceId;
            if (output && deviceId) {
                const midiChannel = parseInt(track.midiChannel, 16);
                if (!isNaN(midiChannel) && midiChannel >= 0 && midiChannel <= 15) {
                     // Method 1: All Sound Off CC (120)
                    // output.send([0xB0 | midiChannel, 120, 0]);
                     // Method 2: All Notes Off CC (123)
                     output.send([0xB0 | midiChannel, 123, 0]);

                      // Method 3: Send Note Off for all 128 notes (most reliable but heavy)
                     // const noteOffCmd = 0x80 | midiChannel;
                     // for (let i = 0; i < 128; i++) {
                     //     output.send([noteOffCmd, i, 0]);
                     // }
                }
            }
        });
     });

      // Reset active step index visually if not a pattern switch while playing
     if (!isPatternSwitch) {
          setSequencerState(prev => ({ ...prev, activeStepIndex: null }));
          sendLedUpdate(-1, state.ledOrder, state.ledTargetDeviceId); // Turn off all LEDs
     }
  };

   // --- LED Feedback Logic ---
   const sendLedUpdate = (activeIndex: number, ledOrder: number[], targetDeviceId?: string) => {
       if (!targetDeviceId || !ledOrder || ledOrder.length !== STEPS_PER_PATTERN) return;

        const targetOutput = getOutputPortById(targetDeviceId);
        if (!targetOutput) return;

        // Turn off all step LEDs first (or just the previous one for efficiency)
        // Turning all off is safer if timing gets weird
        for (let i = 0; i < STEPS_PER_PATTERN; i++) {
            const ledCC = ledOrder[i];
            if (ledCC !== undefined) {
               try{
                 targetOutput.send([0xB0, ledCC, 0]); // Assuming channel 1 (0xB0) for LEDs, adjust if needed
               } catch(e){
                 console.warn(`Failed to send LED OFF for CC ${ledCC}`, e);
                  // Maybe mark this device as problematic?
               }
            }
        }


       // Turn on the active step LED
        if (activeIndex >= 0 && activeIndex < STEPS_PER_PATTERN) {
           const activeLedCC = ledOrder[activeIndex];
           if (activeLedCC !== undefined) {
                try{
                    targetOutput.send([0xB0, activeLedCC, 127]); // Turn on with full value
                } catch(e){
                   console.warn(`Failed to send LED ON for CC ${activeLedCC}`, e);
                }
            }
        }
   };


   // Update LED state based on track/pattern selection
   const updateControlLEDs = (state: SequencerState) => {
        if (!state.ledTargetDeviceId || !state.trackSelectors) return;
        const targetOutput = getOutputPortById(state.ledTargetDeviceId);
        if (!targetOutput) return;

         // Turn off all track selector LEDs first
        state.trackSelectors.forEach(cc => {
             if (cc !== undefined) targetOutput.send([0xB0, cc, 0]);
        });
         // Turn off pattern mode LED
         if (state.midiAssignments.setup_pattern !== undefined) {
            targetOutput.send([0xB0, state.midiAssignments.setup_pattern, 0]);
         }


         // Turn on the active one
         if (state.changePatternMode) {
             const patternIndex = state.patterns[state.currentPatternId]?.patternNumber ?? -1;
              if (patternIndex >= 0 && patternIndex < state.trackSelectors.length) {
                  const patternLedCC = state.trackSelectors[patternIndex];
                  if (patternLedCC !== undefined) targetOutput.send([0xB0, patternLedCC, 127]);
              }
               // Also turn on the pattern button LED itself
               if (state.midiAssignments.setup_pattern !== undefined) {
                    targetOutput.send([0xB0, state.midiAssignments.setup_pattern, 127]);
                }

         } else {
             const trackIndex = state.patterns[state.currentPatternId]?.tracks[state.currentTrackId]?.trackNumber ?? -1;
             if (trackIndex >= 0 && trackIndex < state.trackSelectors.length) {
                const trackLedCC = state.trackSelectors[trackIndex];
                 if (trackLedCC !== undefined) targetOutput.send([0xB0, trackLedCC, 127]);
             }
         }
   }

   // Call updateControlLEDs whenever relevant state changes
    useEffect(() => {
        updateControlLEDs(sequencerState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        sequencerState.currentPatternId,
        sequencerState.currentTrackId,
        sequencerState.changePatternMode,
        sequencerState.ledTargetDeviceId,
        // midiAssignments, trackSelectors, patterns are implicitly part of sequencerState
    ]);


  // --- State Update Functions ---

  const updateStep = useCallback((patternId: string, trackId: string, stepId: string, changes: Partial<Step>) => {
    setSequencerState(prev => {
      const pattern = prev.patterns[patternId];
      const track = pattern?.tracks[trackId];
      if (!track) return prev;

      const newSteps = track.steps.map(step =>
        step.id === stepId ? { ...step, ...changes } : step
      );

      return {
        ...prev,
        patterns: {
          ...prev.patterns,
          [patternId]: {
            ...pattern,
            tracks: {
              ...pattern.tracks,
              [trackId]: {
                ...track,
                steps: newSteps,
              },
            },
          },
        },
      };
    });
  }, []);

   const handleStepToggle = useCallback((stepId: string, forceClear: boolean = false, noteData?: Pick<Step, 'notePitch' | 'velocity' | 'noteLength'>) => {
       setSequencerState(prev => {
           const pattern = prev.patterns[prev.currentPatternId];
           const track = pattern?.tracks[prev.currentTrackId];
           if (!track) return prev;

           const stepIndex = track.steps.findIndex(s => s.id === stepId);
            if (stepIndex === -1) return prev;

           const currentStep = track.steps[stepIndex];
           let changes: Partial<Step>;

           if (forceClear || currentStep.enabled) {
               // Clear the step
               changes = {
                   enabled: false,
                   notePitch: undefined,
                   velocity: undefined,
                   noteLength: undefined,
               };
               // Send note off if playing? Maybe not needed if playStep handles it.
           } else {
                // Enable the step with provided data or default/last data
                changes = {
                    enabled: true,
                    notePitch: noteData?.notePitch ?? prev.lastNoteData?.notePitch ?? 60, // Default to C4 or last note
                    velocity: noteData?.velocity ?? prev.lastNoteData?.velocity ?? DEFAULT_VELOCITY,
                    noteLength: noteData?.noteLength ?? prev.lastNoteData?.noteLength ?? DEFAULT_NOTE_LENGTH,
                };
           }

            const newSteps = [...track.steps];
            newSteps[stepIndex] = { ...currentStep, ...changes };


             return {
               ...prev,
               patterns: {
                 ...prev.patterns,
                 [prev.currentPatternId]: {
                   ...pattern,
                   tracks: {
                     ...pattern.tracks,
                     [prev.currentTrackId]: {
                       ...track,
                       steps: newSteps,
                     },
                   },
                 },
               },
                // Update last note data if enabling a step
                lastNoteData: changes.enabled ? { notePitch: changes.notePitch, velocity: changes.velocity, noteLength: changes.noteLength } : prev.lastNoteData,
             };

       });

   }, []);


   const handleStepSelect = useCallback((stepId: string | null) => {
       setSequencerState(prev => ({ ...prev, selectedStepId: stepId }));
   }, []);


    const handleTrackChange = useCallback((trackId: string, changes: Partial<Track>) => {
        setSequencerState(prev => {
             const pattern = prev.patterns[prev.currentPatternId];
             const track = pattern?.tracks[trackId];
             if (!track) return prev;

              // If output device changes, update the cache
             if (changes.outputDeviceId !== undefined) {
                 midiOutputsRef.current[trackId] = changes.outputDeviceId === 'none'
                    ? undefined
                    : getOutputPortById(changes.outputDeviceId);
                 if(changes.outputDeviceId === 'none') changes.outputDeviceId = undefined; // Store undefined instead of 'none'
             }


             return {
                 ...prev,
                 patterns: {
                     ...prev.patterns,
                     [prev.currentPatternId]: {
                         ...pattern,
                         tracks: {
                             ...pattern.tracks,
                             [trackId]: {
                                 ...track,
                                 ...changes,
                             },
                         },
                     },
                 },
             };
        });
    }, [getOutputPortById]);


    const handleAddTrack = useCallback((trackNumber?: number) => {
         setSequencerState(prev => {
             const pattern = prev.patterns[prev.currentPatternId];
             if (!pattern) return prev;

             const newTrackNumber = trackNumber ?? Object.keys(pattern.tracks).length;
              if (pattern.tracks[`track${newTrackNumber}`]) {
                  console.warn(`Track number ${newTrackNumber} already exists.`);
                  // Maybe find the next available number instead?
                   return prev;
              }

             const newTrack = createInitialTrack(newTrackNumber);

             return {
                 ...prev,
                 patterns: {
                     ...prev.patterns,
                     [prev.currentPatternId]: {
                         ...pattern,
                         tracks: {
                             ...pattern.tracks,
                             [newTrack.id]: newTrack,
                         },
                     },
                 },
                 // Optionally switch to the new track
                 // currentTrackId: newTrack.id,
             };
         });
         toast({ title: "Track Added", description: `Track ${Object.keys(sequencerState.patterns[sequencerState.currentPatternId].tracks).length + 1} created.` });
    }, [sequencerState.currentPatternId, sequencerState.patterns]); // Added dependencies


    const handleDeleteTrack = useCallback((trackId: string) => {
        setSequencerState(prev => {
            const pattern = prev.patterns[prev.currentPatternId];
            if (!pattern || Object.keys(pattern.tracks).length <= 1) {
                 toast({ title: "Cannot Delete", description: "Cannot delete the last track.", variant: "destructive" });
                return prev; // Don't delete the last track
            }

            const newTracks = { ...pattern.tracks };
            delete newTracks[trackId];

             // If deleting the current track, switch to another one
             let newCurrentTrackId = prev.currentTrackId;
             if (prev.currentTrackId === trackId) {
                 newCurrentTrackId = Object.keys(newTracks)[0];
             }

              delete midiOutputsRef.current[trackId]; // Remove from cache

            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [prev.currentPatternId]: {
                        ...pattern,
                        tracks: newTracks,
                    },
                },
                currentTrackId: newCurrentTrackId,
            };
        });
         toast({ title: "Track Deleted" });
    }, []);

     const toggleTrackMute = useCallback((patternId: string, trackId: string) => {
         setSequencerState(prev => {
             const pattern = prev.patterns[patternId];
             const track = pattern?.tracks[trackId];
             if (!track) return prev;

             return {
                 ...prev,
                 patterns: {
                     ...prev.patterns,
                     [patternId]: {
                         ...pattern,
                         tracks: {
                             ...pattern.tracks,
                             [trackId]: {
                                 ...track,
                                 muted: !track.muted,
                             },
                         },
                     },
                 },
             };
         });
     }, []);


    const handleTrackSelect = useCallback((trackId: string) => {
       setSequencerState(prev => ({ ...prev, currentTrackId: trackId, selectedStepId: null })); // Deselect step when changing track
    }, []);


   const handlePatternSelect = useCallback((patternId: string) => {
        setSequencerState(prev => {
            if (!prev.patterns[patternId]) return prev; // Ensure pattern exists

            // If playing, add to queue, otherwise switch immediately
             if (prev.isPlaying) {
                 return { ...prev, nextPatternQueue: [...prev.nextPatternQueue, patternId] };
             } else {
                 allNotesOff(prev); // Send note offs for the old pattern
                 // Find the first track of the new pattern or keep the current track ID if it exists there
                  const newPattern = prev.patterns[patternId];
                  const firstTrackId = Object.keys(newPattern.tracks)[0];
                  const newCurrentTrackId = newPattern.tracks[prev.currentTrackId] ? prev.currentTrackId : firstTrackId;

                  return {
                      ...prev,
                      currentPatternId: patternId,
                      nextPatternQueue: [], // Clear queue on manual switch
                      currentTrackId: newCurrentTrackId, // Switch to first track of new pattern
                      activeStepIndex: null, // Reset step index
                      selectedStepId: null,
                  };
            }
        });
    }, []);

   const handleAddPattern = useCallback((patternNumber?: number) => {
       setSequencerState(prev => {
            const newPatternNumber = patternNumber ?? Object.keys(prev.patterns).length;
             if (prev.patterns[`pattern${newPatternNumber}`]) {
                 console.warn(`Pattern number ${newPatternNumber} already exists.`);
                 return prev;
             }

            // Create a new pattern, potentially copying the current one's structure/settings?
            // Simple approach: create a blank one
            const newPattern = createInitialPattern(newPatternNumber);
            // Copy tracks structure from current pattern?
             const currentPattern = prev.patterns[prev.currentPatternId];
             if (currentPattern) {
                 newPattern.tracks = {}; // Start fresh tracks for the new pattern
                 Object.values(currentPattern.tracks).forEach(track => {
                     const newTrack = createInitialTrack(track.trackNumber);
                     // Copy device/channel settings?
                      newTrack.outputDeviceId = track.outputDeviceId;
                      newTrack.midiChannel = track.midiChannel;
                     newPattern.tracks[newTrack.id] = newTrack;
                 });
             }


            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [newPattern.id]: newPattern,
                },
                // Optionally switch to the new pattern
                 // currentPatternId: newPattern.id,
                 // currentTrackId: Object.keys(newPattern.tracks)[0],
                 // activeStepIndex: null,
                 // selectedStepId: null,
            };
        });
        toast({ title: "Pattern Added", description: `Pattern ${Object.keys(sequencerState.patterns).length + 1} created.` });
    }, [sequencerState.patterns, sequencerState.currentPatternId]); // Added dependencies

     const handleCopyPattern = useCallback((patternIdToCopy: string) => {
       setSequencerState(prev => {
            const patternToCopy = prev.patterns[patternIdToCopy];
            if (!patternToCopy) return prev;

            const newPatternNumber = Object.keys(prev.patterns).length;
             const newPatternId = `pattern${newPatternNumber}`;

            // Deep copy the pattern (simple approach using JSON stringify/parse)
            const newPattern = JSON.parse(JSON.stringify(patternToCopy)) as Pattern;
            newPattern.id = newPatternId;
            newPattern.patternNumber = newPatternNumber;
            newPattern.name = `${patternToCopy.name} Copy`; // Or "Pattern X+1"

            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [newPattern.id]: newPattern,
                },
            };
        });
         toast({ title: "Pattern Copied", description: `Pattern ${Object.keys(sequencerState.patterns).length} created.` });
    }, [sequencerState.patterns]); // Added dependency


    const handleDeletePattern = useCallback((patternIdToDelete: string) => {
       setSequencerState(prev => {
            if (Object.keys(prev.patterns).length <= 1) {
                 toast({ title: "Cannot Delete", description: "Cannot delete the last pattern.", variant: "destructive" });
                return prev; // Don't delete the last pattern
            }
            if (prev.isPlaying && prev.currentPatternId === patternIdToDelete) {
                 toast({ title: "Cannot Delete", description: "Cannot delete the currently playing pattern.", variant: "destructive" });
                return prev; // Don't delete playing pattern
            }

            const newPatterns = { ...prev.patterns };
            delete newPatterns[patternIdToDelete];

            let newCurrentPatternId = prev.currentPatternId;
            if (prev.currentPatternId === patternIdToDelete) {
                newCurrentPatternId = Object.keys(newPatterns)[0]; // Switch to the first remaining pattern
                // Also update current track?
            }

             // Remove from queue if present
             const newQueue = prev.nextPatternQueue.filter(id => id !== patternIdToDelete);

            return {
                ...prev,
                patterns: newPatterns,
                currentPatternId: newCurrentPatternId,
                nextPatternQueue: newQueue,
                 // Update track ID if the pattern changed
                 currentTrackId: prev.currentPatternId === patternIdToDelete
                     ? Object.keys(newPatterns[newCurrentPatternId].tracks)[0]
                     : prev.currentTrackId,
            };
        });
         toast({ title: "Pattern Deleted" });
    }, []);


  const handleBpmChange = useCallback((newBpm: number) => {
    if (newBpm > 0 && newBpm < 999) {
      setSequencerState(prev => ({ ...prev, bpm: newBpm }));
      timerWorkerRef.current?.postMessage({ cmd: 'bpm', value: newBpm });
    }
  }, []);

  const handleSwingChange = useCallback((newSwing: number) => {
     if (newSwing >= 0 && newSwing <= 100) { // Allow 0-100 swing
      setSequencerState(prev => ({ ...prev, swing: newSwing }));
      timerWorkerRef.current?.postMessage({ cmd: 'swing', value: newSwing });
     }
  }, []);

  const handlePlay = useCallback(() => {
    setSequencerState(prev => {
       if (prev.isPlaying) return prev;
        console.log("Starting playback...");
        currentStepRef.current = -1; // Reset step counter before starting
        timerWorkerRef.current?.postMessage({ cmd: 'start' });
        return { ...prev, isPlaying: true, activeStepIndex: -1 }; // Set active index to -1 initially
    });
  }, []);

  const handleStop = useCallback(() => {
    setSequencerState(prev => {
       if (!prev.isPlaying) return prev;
        console.log("Stopping playback...");
        timerWorkerRef.current?.postMessage({ cmd: 'stop' });
         allNotesOff(prev); // Send note offs
        return { ...prev, isPlaying: false, activeStepIndex: null, nextPatternQueue: [] }; // Clear queue on stop
    });
  }, []); // Dependency on sequencerState via allNotesOff

   const handleInputDeviceChange = useCallback((deviceId: string) => {
       setSequencerState(prev => ({
            ...prev,
            selectedInputDeviceId: deviceId === 'none' ? undefined : deviceId,
            // Try to find matching output for LED target
             ledTargetDeviceId: deviceId === 'none' ? undefined : prev.midiOutputDevices.find(out => out.name === prev.midiInputDevices.find(inp => inp.id === deviceId)?.name)?.id ?? prev.ledTargetDeviceId,
       }));
   }, []);

    const handleToggleMidiLearn = useCallback(() => {
        setSequencerState(prev => ({
            ...prev,
            midiLearnActive: !prev.midiLearnActive,
            lastLearnedControl: null, // Reset last learned on toggle
        }));
    }, []);

     const handleSaveMidiAssignments = useCallback((newAssignments: MidiAssignments) => {
        setSequencerState(prev => ({
            ...prev,
            midiAssignments: newAssignments,
             // Update ledOrder and trackSelectors based on new assignments
              ledOrder: Object.entries(newAssignments)
                    .filter(([key]) => key.startsWith('setup_step'))
                    .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_step','')) - parseInt(keyB.replace('setup_step','')))
                    .map(([, value]) => value as number),
              trackSelectors: Object.entries(newAssignments)
                    .filter(([key]) => key.startsWith('setup_track'))
                    .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_track','')) - parseInt(keyB.replace('setup_track','')))
                    .map(([, value]) => value as number),
             midiLearnActive: false, // Turn off learn mode after saving
        }));
        toast({ title: "MIDI Assignments Saved" });
    }, []);

     // Clear functions
     const clearTrack = (patternId: string, trackId: string) => {
        setSequencerState(prev => {
             const pattern = prev.patterns[patternId];
             const track = pattern?.tracks[trackId];
             if (!track) return prev;
             const clearedSteps = track.steps.map(step => ({ ...step, enabled: false, notePitch: undefined, velocity: undefined, noteLength: undefined }));
             return {
                 ...prev,
                 patterns: {
                     ...prev.patterns,
                     [patternId]: {
                         ...pattern,
                         tracks: { ...pattern.tracks, [trackId]: { ...track, steps: clearedSteps } }
                     }
                 }
             };
         });
         toast({ title: "Track Cleared" });
     }

      const clearPattern = (patternId: string) => {
         setSequencerState(prev => {
             const pattern = prev.patterns[patternId];
             if (!pattern) return prev;
             const clearedTracks = Object.entries(pattern.tracks).reduce((acc, [id, track]) => {
                 const clearedSteps = track.steps.map(step => ({ ...step, enabled: false, notePitch: undefined, velocity: undefined, noteLength: undefined }));
                 acc[id] = { ...track, steps: clearedSteps };
                 return acc;
             }, {} as { [trackId: string]: Track });
             return {
                 ...prev,
                 patterns: {
                     ...prev.patterns,
                     [patternId]: { ...pattern, tracks: clearedTracks }
                 }
             };
         });
          toast({ title: "Pattern Cleared" });
      }



  // --- Return Values ---
   const currentPattern = sequencerState.patterns[sequencerState.currentPatternId] ?? Object.values(sequencerState.patterns)[0]; // Fallback needed
   const currentTrack = currentPattern?.tracks[sequencerState.currentTrackId] ?? Object.values(currentPattern?.tracks ?? {})[0]; // Fallback needed


  return {
    sequencerState,
    currentPattern,
    currentTrack,
    midiError,
    actions: {
      handleStepToggle,
      handleStepSelect,
      handleTrackChange,
      handleAddTrack,
      handleDeleteTrack,
      handleTrackSelect,
      handlePatternSelect,
      handleAddPattern,
      handleCopyPattern,
      handleDeletePattern,
      handleBpmChange,
      handleSwingChange,
      handlePlay,
      handleStop,
      handleInputDeviceChange,
      handleToggleMidiLearn,
      handleSaveMidiAssignments,
      clearTrack: (trackId: string) => clearTrack(sequencerState.currentPatternId, trackId), // Provide bound versions
      clearPattern: () => clearPattern(sequencerState.currentPatternId),
      toggleTrackMute: (trackId: string) => toggleTrackMute(sequencerState.currentPatternId, trackId),
    },
  };
}

