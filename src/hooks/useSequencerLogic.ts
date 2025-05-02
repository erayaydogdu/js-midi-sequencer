
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  const activeNotesRef = useRef<{ [trackId: string]: { [note: number]: number } }>({}); // trackId -> note -> stepIndexStarted

  // --- Forward declare MIDI access functions needed by handlers ---
  const midiHookRef = useRef<ReturnType<typeof useMIDI> | null>(null);
  const sendMIDI = useCallback((deviceId: string, data: number[] | Uint8Array) => {
      midiHookRef.current?.sendMIDI(deviceId, data);
  }, []);
  const getOutputPortById = useCallback((id: string): MIDIOutput | undefined => {
       return midiHookRef.current?.getOutputPortById(id);
  }, []);


  // --- Handler Definitions (defined before useMIDI and handleMIDIMessage) ---

   const handleStepToggle = useCallback((stepId: string, forceClear: boolean = false, noteData?: Pick<Step, 'notePitch' | 'velocity' | 'noteLength'>) => {
       setSequencerState(prev => {
           const pattern = prev.patterns[prev.currentPatternId];
           const track = pattern?.tracks[prev.currentTrackId];
           if (!track) return prev;

           const stepIndex = track.steps.findIndex(s => s.id === stepId);
            if (stepIndex === -1) return prev;

           const currentStep = track.steps[stepIndex];
           let changes: Partial<Step>;
           let newLastNoteData = prev.lastNoteData;

           if (forceClear || currentStep.enabled) {
               changes = { enabled: false, notePitch: undefined, velocity: undefined, noteLength: undefined };
           } else {
                const pitch = noteData?.notePitch ?? prev.lastNoteData?.notePitch ?? 60;
                const vel = noteData?.velocity ?? prev.lastNoteData?.velocity ?? DEFAULT_VELOCITY;
                const len = noteData?.noteLength ?? prev.lastNoteData?.noteLength ?? DEFAULT_NOTE_LENGTH;
                changes = { enabled: true, notePitch: pitch, velocity: vel, noteLength: len };
                newLastNoteData = { notePitch: pitch, velocity: vel, noteLength: len };
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
                lastNoteData: newLastNoteData,
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

            let newOutputDeviceId = changes.outputDeviceId;
            // Handle 'none' selection and update cache
            if (newOutputDeviceId !== undefined) {
                const localGetOutputPortById = midiHookRef.current?.getOutputPortById; // Access via ref
                if (!localGetOutputPortById) return prev; // MIDI might not be ready

                if (newOutputDeviceId === 'none') {
                    newOutputDeviceId = undefined; // Store undefined internally
                    midiOutputsRef.current[trackId] = undefined;
                } else {
                    const port = localGetOutputPortById(newOutputDeviceId);
                    midiOutputsRef.current[trackId] = port;
                    if (!port) {
                       console.warn(`Selected output device ${newOutputDeviceId} not found.`);
                       // Optionally revert or show error?
                       // newOutputDeviceId = track.outputDeviceId; // Revert
                    }
                }
                changes.outputDeviceId = newOutputDeviceId; // Ensure change reflects internal value
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
   }, []); // Removed getOutputPortById, accessed via ref

   const handleAddTrack = useCallback((trackNumber?: number) => {
        setSequencerState(prev => {
            const pattern = prev.patterns[prev.currentPatternId];
            if (!pattern) return prev;

             let newTrackNum = trackNumber !== undefined ? trackNumber : -1;
             if (newTrackNum === -1) {
                // Find the lowest available track number
                const existingNumbers = Object.values(pattern.tracks).map(t => t.trackNumber);
                newTrackNum = 0;
                while (existingNumbers.includes(newTrackNum)) {
                    newTrackNum++;
                }
             }

             if (pattern.tracks[`track${newTrackNum}`]) {
                 console.warn(`Track number ${newTrackNum} already exists.`);
                 return prev;
             }

            const newTrack = createInitialTrack(newTrackNum);

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
            };
        });
        // Use a function for toast to get the latest state after update
        setSequencerState(prev => {
            toast({ title: "Track Added", description: `Track ${Object.keys(prev.patterns[prev.currentPatternId].tracks).length} created.` });
            return prev;
        });
   }, []);

   const handleDeleteTrack = useCallback((trackId: string) => {
       setSequencerState(prev => {
           const pattern = prev.patterns[prev.currentPatternId];
           if (!pattern || Object.keys(pattern.tracks).length <= 1) {
                toast({ title: "Cannot Delete", description: "Cannot delete the last track.", variant: "destructive" });
               return prev;
           }

           const newTracks = { ...pattern.tracks };
           delete newTracks[trackId];

            let newCurrentTrackId = prev.currentTrackId;
            if (prev.currentTrackId === trackId) {
                newCurrentTrackId = Object.keys(newTracks)[0];
            }

             delete midiOutputsRef.current[trackId];
             delete activeNotesRef.current[trackId];

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

             // If unmuting, ensure active notes for this track are cleared
             if (track.muted) {
                 delete activeNotesRef.current[trackId];
                 const output = midiOutputsRef.current[trackId];
                 const deviceId = track.outputDeviceId;
                  if (output && deviceId) {
                       const midiChannel = parseInt(track.midiChannel, 16);
                       if (!isNaN(midiChannel) && midiChannel >= 0 && midiChannel <= 15) {
                          try {
                               output.send([0xB0 | midiChannel, 123, 0]); // All Notes Off CC
                          } catch(e) { console.warn("MIDI send error on unmute", e); }
                       }
                  }
             }

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
      setSequencerState(prev => ({ ...prev, currentTrackId: trackId, selectedStepId: null }));
   }, []);

    // Needs allNotesOff defined first
   const allNotesOff = useCallback((state: SequencerState, isPatternSwitch: boolean = false) => {
     console.log("Sending All Notes Off");
     Object.values(state.patterns).forEach(pattern => {
        Object.values(pattern.tracks).forEach(track => {
            const output = midiOutputsRef.current[track.id];
            const deviceId = track.outputDeviceId;
            if (output && deviceId) {
                const midiChannel = parseInt(track.midiChannel, 16);
                if (!isNaN(midiChannel) && midiChannel >= 0 && midiChannel <= 15) {
                    try {
                        output.send([0xB0 | midiChannel, 123, 0]);
                    } catch (e) {
                        console.warn(`MIDI Send Error (All Notes Off Ch ${midiChannel + 1}):`, e);
                    }
                }
            }
        });
     });
      activeNotesRef.current = {};
     if (!isPatternSwitch) {
          setSequencerState(prev => ({ ...prev, activeStepIndex: null }));
          // Use local sendLedUpdate defined later
          // sendLedUpdate(-1, state.ledOrder, state.ledTargetDeviceId);
     }
   }, []); // Dependencies managed via refs or passed state

   const handlePatternSelect = useCallback((patternId: string) => {
       setSequencerState(prev => {
           if (!prev.patterns[patternId]) return prev;
            if (prev.isPlaying) {
               if (!prev.nextPatternQueue.includes(patternId) && patternId !== prev.currentPatternId) {
                   return { ...prev, nextPatternQueue: [...prev.nextPatternQueue, patternId] };
               }
               return prev;
            } else {
                if (patternId === prev.currentPatternId) return prev;
                allNotesOff(prev); // Use the existing allNotesOff function
                 const newPattern = prev.patterns[patternId];
                 const firstTrackId = Object.keys(newPattern.tracks)[0];
                 const newCurrentTrackId = newPattern.tracks[prev.currentTrackId] ? prev.currentTrackId : firstTrackId;
                 return {
                     ...prev,
                     currentPatternId: patternId,
                     nextPatternQueue: [],
                     currentTrackId: newCurrentTrackId,
                     activeStepIndex: null,
                     selectedStepId: null,
                 };
           }
       });
   }, [allNotesOff]); // Add allNotesOff dependency

  const handleAddPattern = useCallback((patternNumber?: number) => {
      setSequencerState(prev => {
            let newPatternNum = patternNumber !== undefined ? patternNumber : -1;
             if (newPatternNum === -1) {
                const existingNumbers = Object.values(prev.patterns).map(p => p.patternNumber);
                newPatternNum = 0;
                while (existingNumbers.includes(newPatternNum)) {
                    newPatternNum++;
                }
             }
            if (prev.patterns[`pattern${newPatternNum}`]) {
                console.warn(`Pattern number ${newPatternNum} already exists.`);
                return prev;
            }
           const newPattern = createInitialPattern(newPatternNum);
            const currentPattern = prev.patterns[prev.currentPatternId];
            if (currentPattern) {
                newPattern.tracks = {};
                Object.values(currentPattern.tracks).forEach(track => {
                    const newTrack = createInitialTrack(track.trackNumber);
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
           };
       });
        setSequencerState(prev => {
           toast({ title: "Pattern Added", description: `Pattern ${Object.keys(prev.patterns).length} created.` });
           return prev;
        });
   }, []);

    const handleCopyPattern = useCallback((patternIdToCopy: string) => {
      setSequencerState(prev => {
           const patternToCopy = prev.patterns[patternIdToCopy];
           if (!patternToCopy) return prev;
           let newPatternNum = -1;
            const existingNumbers = Object.values(prev.patterns).map(p => p.patternNumber);
            newPatternNum = 0;
            while (existingNumbers.includes(newPatternNum)) {
                newPatternNum++;
            }
            const newPatternId = `pattern${newPatternNum}`;
           try {
               const newPattern = JSON.parse(JSON.stringify(patternToCopy)) as Pattern;
               newPattern.id = newPatternId;
               newPattern.patternNumber = newPatternNum;
               newPattern.name = `Pattern ${newPatternNum + 1}`;
               return {
                   ...prev,
                   patterns: {
                       ...prev.patterns,
                       [newPattern.id]: newPattern,
                   },
               };
           } catch (e) {
                console.error("Failed to copy pattern:", e);
                toast({ title: "Copy Failed", description: "Could not copy the pattern.", variant: "destructive" });
                return prev;
           }
       });
       setSequencerState(prev => {
            toast({ title: "Pattern Copied", description: `Pattern ${Object.keys(prev.patterns).length} created.` });
            return prev;
        });
   }, []);

   const handleDeletePattern = useCallback((patternIdToDelete: string) => {
      setSequencerState(prev => {
           if (Object.keys(prev.patterns).length <= 1) {
                toast({ title: "Cannot Delete", description: "Cannot delete the last pattern.", variant: "destructive" });
               return prev;
           }
           if (prev.isPlaying && prev.currentPatternId === patternIdToDelete) {
                toast({ title: "Cannot Delete", description: "Stop playback to delete the current pattern.", variant: "destructive" });
               return prev;
           }
           const newPatterns = { ...prev.patterns };
           delete newPatterns[patternIdToDelete];
           let newCurrentPatternId = prev.currentPatternId;
           if (prev.currentPatternId === patternIdToDelete) {
               newCurrentPatternId = Object.keys(newPatterns)[0];
           }
            const newQueue = prev.nextPatternQueue.filter(id => id !== patternIdToDelete);
             const newCurrentPattern = newPatterns[newCurrentPatternId];
             let newCurrentTrackId = prev.currentTrackId;
              if (!newCurrentPattern || !newCurrentPattern.tracks[newCurrentTrackId]) {
                  newCurrentTrackId = Object.keys(newCurrentPattern?.tracks ?? {})[0] || createInitialTrack(0).id;
              }
           return {
               ...prev,
               patterns: newPatterns,
               currentPatternId: newCurrentPatternId,
               currentTrackId: newCurrentTrackId,
               nextPatternQueue: newQueue,
           };
       });
        toast({ title: "Pattern Deleted" });
   }, []);

 const handleBpmChange = useCallback((newBpm: number) => {
   if (newBpm > 0 && newBpm < 999) {
     setSequencerState(prev => {
       if(prev.bpm === newBpm) return prev;
       timerWorkerRef.current?.postMessage({ cmd: 'bpm', value: newBpm });
       return { ...prev, bpm: newBpm };
     });
   }
 }, []);

 const handleSwingChange = useCallback((newSwing: number) => {
    if (newSwing >= 0 && newSwing <= 75) {
     setSequencerState(prev => {
        if (prev.swing === newSwing) return prev;
        timerWorkerRef.current?.postMessage({ cmd: 'swing', value: newSwing });
        return { ...prev, swing: newSwing };
     });
    }
 }, []);

 const handlePlay = useCallback(() => {
   setSequencerState(prev => {
      if (prev.isPlaying) return prev;
       console.log("Starting playback...");
       currentStepRef.current = -1;
       timerWorkerRef.current?.postMessage({ cmd: 'start' });
       return { ...prev, isPlaying: true, activeStepIndex: -1 };
   });
 }, []);

 const handleStop = useCallback(() => {
   setSequencerState(prev => {
      if (!prev.isPlaying) return prev;
       console.log("Stopping playback...");
       timerWorkerRef.current?.postMessage({ cmd: 'stop' });
       const currentState = {...prev, isPlaying: false, activeStepIndex: null, nextPatternQueue: []};
        allNotesOff(currentState, false); // Pass current state
       return currentState;
   });
 }, [allNotesOff]); // Add allNotesOff dependency


  const handleInputDeviceChange = useCallback((deviceId: string) => {
      setSequencerState(prev => {
          const newDeviceId = deviceId === 'none' ? undefined : deviceId;
          if(prev.selectedInputDeviceId === newDeviceId) return prev;
           const selectedInputDevice = prev.midiInputDevices.find(d => d.id === newDeviceId);
           const newLedTargetId = newDeviceId === undefined ? undefined : prev.midiOutputDevices.find(out => out.name === selectedInputDevice?.name)?.id ?? prev.ledTargetDeviceId;
          return {
               ...prev,
               selectedInputDeviceId: newDeviceId,
               ledTargetDeviceId: newLedTargetId,
          };
      });
  }, []);

   const handleToggleMidiLearn = useCallback(() => {
       setSequencerState(prev => ({
           ...prev,
           midiLearnActive: !prev.midiLearnActive,
           lastLearnedControl: null,
       }));
   }, []);

    const handleSaveMidiAssignments = useCallback((newAssignments: MidiAssignments) => {
       setSequencerState(prev => {
            const sanitizedAssignments = Object.entries(newAssignments).reduce((acc, [key, value]) => {
                acc[key as keyof MidiAssignments] = typeof value === 'number' && !isNaN(value) ? value : undefined;
                return acc;
            }, {} as MidiAssignments);
            const newLedOrder = Object.entries(sanitizedAssignments)
                   .filter(([key]) => key.startsWith('setup_step'))
                   .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_step','')) - parseInt(keyB.replace('setup_step','')))
                   .map(([, value]) => value as number);
            const newTrackSelectors = Object.entries(sanitizedAssignments)
                   .filter(([key]) => key.startsWith('setup_track'))
                   .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_track','')) - parseInt(keyB.replace('setup_track','')))
                   .map(([, value]) => value as number);
           return {
               ...prev,
               midiAssignments: sanitizedAssignments,
               ledOrder: newLedOrder,
               trackSelectors: newTrackSelectors,
               midiLearnActive: false,
           };
       });
       toast({ title: "MIDI Assignments Saved" });
   }, []);

    // --- Clear Functions ---
    const clearTrack = useCallback((patternId: string, trackId: string) => {
       setSequencerState(prev => {
            const pattern = prev.patterns[patternId];
            const track = pattern?.tracks[trackId];
            if (!track) return prev;
            const clearedSteps = track.steps.map((step, index) => createInitialStep(index));
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
    }, []);

     const clearPattern = useCallback((patternId: string) => {
        setSequencerState(prev => {
            const pattern = prev.patterns[patternId];
            if (!pattern) return prev;
            const clearedTracks = Object.entries(pattern.tracks).reduce((acc, [id, track]) => {
                acc[id] = { ...track, steps: track.steps.map((step, index) => createInitialStep(index)) };
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
     }, []);


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
                          // Clear selected step
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
                                    console.log(`Attempted to select non-existent pattern ${trackOrPatternIndex + 1}`);
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
                                    // Create new track and select it
                                     handleAddTrack(trackOrPatternIndex);
                                     handleTrackSelect(`track${trackOrPatternIndex}`);
                                }
                            }
                        } else { // Button Release
                            // Reset flags maybe?
                         }
                     }
                 // --- Note Parameter Controls (apply to selected step) ---
                      else if (prevState.selectedStepId) {
                          const currentStep = currentTrack?.steps.find(s => s.id === prevState.selectedStepId);
                          if (currentStep) {
                               let changes: Partial<Step> = {};
                               let newLastNoteData = {...prevState.lastNoteData};
                               switch (assignmentKey) {
                                   case 'setup_notepitch':
                                        changes = { notePitch: noteOrCC, enabled: true, velocity: currentStep.velocity ?? DEFAULT_VELOCITY, noteLength: currentStep.noteLength ?? DEFAULT_NOTE_LENGTH };
                                        newLastNoteData = {notePitch: changes.notePitch, velocity: changes.velocity, noteLength: changes.noteLength};
                                       break;
                                   case 'setup_velocity':
                                       changes = { velocity: velocityOrValue, enabled: true }; // Ensure step is enabled if setting velocity
                                       newLastNoteData = {...prevState.lastNoteData, velocity: changes.velocity };
                                       break;
                                    case 'setup_notelength':
                                        const length = Math.max(1, Math.min(STEPS_PER_PATTERN, Math.round((velocityOrValue / 127) * (STEPS_PER_PATTERN -1)) + 1));
                                        changes = { noteLength: length, enabled: true }; // Ensure step is enabled
                                        newLastNoteData = {...prevState.lastNoteData, noteLength: changes.noteLength };
                                        break;
                               }
                                if (Object.keys(changes).length > 0) {
                                   // Directly update state here instead of calling updateStep to include lastNoteData
                                    const pattern = prevState.patterns[prevState.currentPatternId];
                                    const track = pattern?.tracks[prevState.currentTrackId];
                                    if (!track) return prevState;
                                    const newSteps = track.steps.map(step =>
                                      step.id === prevState.selectedStepId ? { ...step, ...changes } : step
                                    );
                                    return {
                                       ...prevState,
                                       patterns: {
                                         ...prevState.patterns,
                                         [prevState.currentPatternId]: {
                                           ...pattern,
                                           tracks: {
                                             ...pattern.tracks,
                                             [prevState.currentTrackId]: {
                                               ...track,
                                               steps: newSteps,
                                             },
                                           },
                                         },
                                       },
                                       lastNoteData: newLastNoteData, // Update lastNoteData
                                    };
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
                       noteLength: currentStep?.noteLength ?? DEFAULT_NOTE_LENGTH,
                   };
                   const newLastNoteData = {notePitch: changes.notePitch, velocity: changes.velocity, noteLength: changes.noteLength};

                    // Directly update state here
                    const pattern = prevState.patterns[prevState.currentPatternId];
                    const track = pattern?.tracks[prevState.currentTrackId];
                    if (!track) return prevState;
                    const newSteps = track.steps.map(step =>
                      step.id === prevState.selectedStepId ? { ...step, ...changes } : step
                    );
                    return {
                       ...prevState,
                       patterns: {
                         ...prevState.patterns,
                         [prevState.currentPatternId]: {
                           ...pattern,
                           tracks: {
                             ...pattern.tracks,
                             [prevState.currentTrackId]: {
                               ...track,
                               steps: newSteps,
                             },
                           },
                         },
                       },
                       lastNoteData: newLastNoteData,
                    };
              }
          }
         return prevState; // Return previous state if no changes handled
     });

   }, [
       handlePlay, handleStop, handleBpmChange, handleSwingChange, handleStepToggle,
       handlePatternSelect, toggleTrackMute, handleTrackSelect, handleAddTrack,
       clearPattern, clearTrack, handleStepSelect
   ]); // Added explicit dependencies


   const midiHook = useMIDI({ onMessage: handleMIDIMessage });
   midiHookRef.current = midiHook; // Store the hook's return value in the ref
   const { midiAccess, inputDevices, outputDevices, error: midiError } = midiHook; // Destructure for return

   // Update device lists in state when useMIDI provides them
   useEffect(() => {
    setSequencerState(prev => {
        // Avoid unnecessary updates if devices haven't changed
        if (prev.midiInputDevices === inputDevices && prev.midiOutputDevices === outputDevices) {
            return prev;
        }

        const firstInputId = inputDevices[0]?.id;
        const selectedInputId = prev.selectedInputDeviceId ?? firstInputId;
        const selectedInputDevice = inputDevices.find(d => d.id === selectedInputId);
        // Fallback ledTargetId logic now relies on the stable getOutputPortById from the ref
        const localGetOutputPortById = midiHookRef.current?.getOutputPortById;
        const ledTargetId = prev.ledTargetDeviceId ?? (selectedInputDevice && localGetOutputPortById ? outputDevices.find(out => out.name === selectedInputDevice?.name)?.id : undefined);


        return {
            ...prev,
            midiInputDevices: inputDevices,
            midiOutputDevices: outputDevices,
            selectedInputDeviceId: selectedInputId,
            ledTargetDeviceId: ledTargetId,
        };
    });

     // Update MIDI output cache (only if output devices change)
      const newOutputsCache: { [trackId: string]: MIDIOutput | undefined } = {};
      const localGetOutputPortById = midiHookRef.current?.getOutputPortById; // Get from ref
       if (localGetOutputPortById) {
           Object.values(sequencerState.patterns).forEach(pattern => {
             Object.values(pattern.tracks).forEach(track => {
               if (track.outputDeviceId) {
                 const outputPort = localGetOutputPortById(track.outputDeviceId);
                 if(outputPort){
                     newOutputsCache[track.id] = outputPort;
                 }
               }
             });
           });
       }
      // Only update ref if the content has changed to avoid loops
       if (JSON.stringify(midiOutputsRef.current) !== JSON.stringify(newOutputsCache)) {
          midiOutputsRef.current = newOutputsCache;
       }

  }, [inputDevices, outputDevices, sequencerState.patterns, sequencerState.selectedInputDeviceId, sequencerState.ledTargetDeviceId]);


   // --- Load/Save State (Example using localStorage) ---
   useEffect(() => {
     const savedState = localStorage.getItem('sequencerState');
     let loadedState: Partial<SequencerState> = {};

     if (savedState) {
       try {
         loadedState = JSON.parse(savedState) as Partial<SequencerState>;
         console.log("Sequencer state loaded from localStorage.");
       } catch (e) {
         console.error("Failed to parse saved sequencer state:", e);
         localStorage.removeItem('sequencerState'); // Clear invalid state
       }
     }

     // Load MIDI assignments separately if stored differently or if full state failed
     const savedAssignments = localStorage.getItem('midiAssignments');
      if (savedAssignments && !loadedState.midiAssignments) {
          try {
              const parsedAssignments = JSON.parse(savedAssignments);
              loadedState.midiAssignments = parsedAssignments;
               console.log("MIDI assignments loaded from legacy localStorage.");
          } catch(e) {
              console.error("Failed to parse legacy MIDI assignments:", e);
              localStorage.removeItem('midiAssignments');
          }
      }

     if (Object.keys(loadedState).length > 0) {
        setSequencerState(prev => {
           // Merge loaded state with initial defaults carefully
           const mergedState: SequencerState = {
               ...prev, // Start with initial defaults
               ...loadedState, // Overwrite with loaded values
               midiInputDevices: prev.midiInputDevices, // Keep current devices
               midiOutputDevices: prev.midiOutputDevices, // Keep current devices
               isPlaying: false, // Always start stopped
               activeStepIndex: null,
               lastLearnedControl: null, // Don't persist temporary learn state
               // Ensure patterns and tracks structure is valid after loading
               patterns: loadedState.patterns || prev.patterns,
               currentPatternId: loadedState.currentPatternId || prev.currentPatternId,
               currentTrackId: loadedState.currentTrackId || prev.currentTrackId,
               // Ensure essential assignments are numbers
                midiAssignments: Object.entries(loadedState.midiAssignments || {}).reduce((acc, [key, value]) => {
                   acc[key as keyof MidiAssignments] = typeof value === 'number' ? value : undefined;
                   return acc;
               }, {} as MidiAssignments),
                // Load ledOrder and trackSelectors, ensure they are arrays of numbers
                ledOrder: Array.isArray(loadedState.ledOrder) ? loadedState.ledOrder.filter(n => typeof n === 'number') : [],
                trackSelectors: Array.isArray(loadedState.trackSelectors) ? loadedState.trackSelectors.filter(n => typeof n === 'number') : [],
           };

             // Ensure current pattern and track IDs are valid
             if (!mergedState.patterns[mergedState.currentPatternId]) {
                 mergedState.currentPatternId = Object.keys(mergedState.patterns)[0] || createInitialPattern(0).id;
                 if (!mergedState.patterns[mergedState.currentPatternId]) {
                     mergedState.patterns[mergedState.currentPatternId] = createInitialPattern(0); // Ensure at least one pattern exists
                 }
             }
             const currentPattern = mergedState.patterns[mergedState.currentPatternId];
             if (!currentPattern.tracks[mergedState.currentTrackId]) {
                 mergedState.currentTrackId = Object.keys(currentPattern.tracks)[0] || createInitialTrack(0).id;
                 if (!currentPattern.tracks[mergedState.currentTrackId]) {
                     currentPattern.tracks[mergedState.currentTrackId] = createInitialTrack(0); // Ensure at least one track exists
                 }
             }

             return mergedState;
        });
     }

   }, []); // Load once on mount

   useEffect(() => {
     // Debounce saving state? For now, save directly.
     try {
        const stateToSave = { ...sequencerState };
        // Avoid saving transient or hardware-related state
        delete (stateToSave as Partial<SequencerState>).midiInputDevices;
        delete (stateToSave as Partial<SequencerState>).midiOutputDevices;
        delete (stateToSave as Partial<SequencerState>).lastLearnedControl;
        delete (stateToSave as Partial<SequencerState>).activeStepIndex;
        delete (stateToSave as Partial<SequencerState>).isPlaying;

        localStorage.setItem('sequencerState', JSON.stringify(stateToSave));
        // Also save legacy assignments if needed (optional)
        // localStorage.setItem('midiAssignments', JSON.stringify(sequencerState.midiAssignments));
     } catch (e) {
        console.error("Error saving sequencer state to localStorage:", e);
     }
   }, [sequencerState]);


    // --- LED Feedback Logic ---
    const sendLedUpdate = useCallback((activeIndex: number, ledOrder: number[], targetDeviceId?: string) => {
        const localGetOutputPortById = midiHookRef.current?.getOutputPortById; // Get from ref
        if (!targetDeviceId || !ledOrder || ledOrder.length === 0 || !localGetOutputPortById) return;

         const targetOutput = localGetOutputPortById(targetDeviceId);
         if (!targetOutput) return;

         try {
             for (let i = 0; i < ledOrder.length; i++) {
                 const ledCC = ledOrder[i];
                 if (ledCC !== undefined) {
                     targetOutput.send([0xB0, ledCC, 0]); // Assuming channel 1 (0xB0)
                 }
             }
             if (activeIndex >= 0 && activeIndex < ledOrder.length) {
                const activeLedCC = ledOrder[activeIndex];
                if (activeLedCC !== undefined) {
                     targetOutput.send([0xB0, activeLedCC, 127]); // Turn on
                 }
             }
         } catch(e){
            console.warn(`Failed to send LED update to ${targetDeviceId}`, e);
         }
    }, []);


  // --- Playback Logic ---
   const playStep = useCallback((stepIndex: number, state: SequencerState) => {
       const pattern = state.patterns[state.currentPatternId];
       if (!pattern) return;

       // --- LED Feedback ---
       sendLedUpdate(stepIndex, state.ledOrder, state.ledTargetDeviceId);

       // --- Note On/Off Logic ---
       Object.values(pattern.tracks).forEach(track => {
           if (track.muted) return;

           const step = track.steps[stepIndex];
           const output = midiOutputsRef.current[track.id];
           const midiChannel = parseInt(track.midiChannel, 16);

           if (!output || isNaN(midiChannel) || midiChannel < 0 || midiChannel > 15 || !track.outputDeviceId) return;

           const noteOnCmd = 0x90 | midiChannel;
           const noteOffCmd = 0x80 | midiChannel;
           const currentTranspose = track.transpose || 0;

           // --- Handle Note Offs ---
            if (!activeNotesRef.current[track.id]) activeNotesRef.current[track.id] = {};
            const activeTrackNotes = activeNotesRef.current[track.id];
            for (const note in activeTrackNotes) {
                const notePitch = parseInt(note);
                const startStepIndex = activeTrackNotes[notePitch];
                const noteDef = track.steps[startStepIndex];
                const noteLength = noteDef?.noteLength ?? 1;
                const endStepIndex = (startStepIndex + noteLength) % STEPS_PER_PATTERN;

                if (endStepIndex === stepIndex) {
                    try {
                        sendMIDI(track.outputDeviceId!, [noteOffCmd, notePitch, 0]);
                    } catch (e) { console.warn(`MIDI Send Error (Note Off ${notePitch}):`, e); }
                    delete activeTrackNotes[notePitch];
                }
            }

           // --- Handle Note Ons ---
           if (step.enabled && step.notePitch !== undefined) {
               const pitch = step.notePitch + currentTranspose;
               const velocity = step.velocity ?? DEFAULT_VELOCITY;
                if (pitch >= 0 && pitch <= 127) {
                    try {
                        sendMIDI(track.outputDeviceId!, [noteOnCmd, pitch, velocity]);
                        activeTrackNotes[pitch] = stepIndex;
                    } catch (e) { console.warn(`MIDI Send Error (Note On ${pitch}):`, e); }
                }
           }
       });
   }, [sendMIDI, sendLedUpdate]); // Include sendMIDI and sendLedUpdate dependencies


  // --- Web Worker Timer ---
  useEffect(() => {
    timerWorkerRef.current = new Worker(new URL('../workers/timerWorker.ts', import.meta.url));
    let localIsPlaying = false;

    timerWorkerRef.current.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'tick') {
        setSequencerState(prev => {
            if (!prev.isPlaying) return prev;
            localIsPlaying = true;
            const currentPatternId = prev.patterns[prev.currentPatternId]
                ? prev.currentPatternId
                : Object.keys(prev.patterns)[0] || null;
            if (!currentPatternId) return prev;

            const newActiveStepIndex = e.data.step;
            playStep(newActiveStepIndex, prev); // Call playStep which now includes LED update

             let nextPatternId = currentPatternId;
             let nextQueue = [...prev.nextPatternQueue];
             if (newActiveStepIndex === STEPS_PER_PATTERN - 1 && nextQueue.length > 0) {
                nextPatternId = nextQueue.shift()!;
                allNotesOff(prev, true); // Pass state, pattern switch true
                 console.log(`Switching to pattern: ${nextPatternId}`);
             }

            return {
                ...prev,
                activeStepIndex: newActiveStepIndex,
                currentPatternId: nextPatternId,
                nextPatternQueue: nextQueue,
            };
        });
      }
    };

     timerWorkerRef.current.postMessage({ cmd: 'bpm', value: sequencerState.bpm });
     timerWorkerRef.current.postMessage({ cmd: 'swing', value: sequencerState.swing });

    return () => {
      console.log("Terminating timer worker");
      timerWorkerRef.current?.postMessage({ cmd: 'stop' });
      timerWorkerRef.current?.terminate();
      timerWorkerRef.current = null;
      if (localIsPlaying) {
        // Need to capture the *final* state for allNotesOff
         setSequencerState(finalState => {
            allNotesOff(finalState, false); // Pass final state
             return finalState; // Return unchanged state
         });
      }
       activeNotesRef.current = {};
    };
  }, [playStep, allNotesOff, sequencerState.bpm, sequencerState.swing]); // Added playStep, allNotesOff dependencies


   // Call updateControlLEDs whenever relevant state changes
    const updateControlLEDs = useCallback((state: SequencerState) => {
         const localGetOutputPortById = midiHookRef.current?.getOutputPortById; // Get from ref
         if (!state.ledTargetDeviceId || !state.trackSelectors || !localGetOutputPortById) return;
         const targetOutput = localGetOutputPortById(state.ledTargetDeviceId);
         if (!targetOutput) return;

         try {
             state.trackSelectors.forEach(cc => {
                  if (cc !== undefined) targetOutput.send([0xB0, cc, 0]);
             });
              if (state.midiAssignments.setup_pattern !== undefined) {
                 targetOutput.send([0xB0, state.midiAssignments.setup_pattern, 0]);
              }
              if (state.changePatternMode) {
                  const patternIndex = state.patterns[state.currentPatternId]?.patternNumber ?? -1;
                   if (patternIndex >= 0 && patternIndex < state.trackSelectors.length) {
                       const patternLedCC = state.trackSelectors[patternIndex];
                       if (patternLedCC !== undefined) targetOutput.send([0xB0, patternLedCC, 127]);
                   }
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
          } catch (e) {
             console.warn(`Failed to send control LED update to ${state.ledTargetDeviceId}`, e);
          }
    }, []); // Dependencies managed via refs or passed state

    useEffect(() => {
        updateControlLEDs(sequencerState);
    }, [
        sequencerState.currentPatternId,
        sequencerState.currentTrackId,
        sequencerState.changePatternMode,
        sequencerState.ledTargetDeviceId,
        sequencerState.patterns,
        sequencerState.midiAssignments.setup_pattern,
        sequencerState.trackSelectors,
        updateControlLEDs // Add the function itself as dependency
    ]);


  // --- Return Values ---
   const currentPattern = sequencerState.patterns[sequencerState.currentPatternId] ?? Object.values(sequencerState.patterns)[0] ?? createInitialPattern(0);
   const currentTrack = currentPattern?.tracks[sequencerState.currentTrackId] ?? Object.values(currentPattern?.tracks ?? {})[0] ?? createInitialTrack(0);

   // Use useMemo for actions to ensure stable references
   const actions = useMemo(() => ({
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
     clearTrack: (trackId: string) => clearTrack(sequencerState.currentPatternId, trackId),
     clearPattern: () => clearPattern(sequencerState.currentPatternId),
     toggleTrackMute: (trackId: string) => toggleTrackMute(sequencerState.currentPatternId, trackId),
   }), [
       handleStepToggle, handleStepSelect, handleTrackChange, handleAddTrack, handleDeleteTrack,
       handleTrackSelect, handlePatternSelect, handleAddPattern, handleCopyPattern, handleDeletePattern,
       handleBpmChange, handleSwingChange, handlePlay, handleStop, handleInputDeviceChange,
       handleToggleMidiLearn, handleSaveMidiAssignments, clearTrack, clearPattern, toggleTrackMute,
       sequencerState.currentPatternId // Include IDs needed for bound functions
   ]);


  return {
    sequencerState,
    currentPattern,
    currentTrack,
    midiError,
    actions,
  };
}
