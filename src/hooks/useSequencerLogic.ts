
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
            if ('outputDeviceId' in changes) { // Check if outputDeviceId is explicitly being changed
                const localGetOutputPortById = midiHookRef.current?.getOutputPortById; // Access via ref
                if (!localGetOutputPortById) return prev; // MIDI might not be ready

                if (newOutputDeviceId === 'none' || newOutputDeviceId === undefined) {
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

            const updatedPattern = {
              ...pattern,
              tracks: {
                ...pattern.tracks,
                [newTrack.id]: newTrack,
              },
            };

            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [prev.currentPatternId]: updatedPattern,
                },
                // Optionally select the new track immediately
                // currentTrackId: newTrack.id,
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
                // Select the first available track if the current one is deleted
                newCurrentTrackId = Object.keys(newTracks)[0];
            }

             delete midiOutputsRef.current[trackId];
             delete activeNotesRef.current[trackId];

            const updatedPattern = {
              ...pattern,
              tracks: newTracks,
            };

           return {
               ...prev,
               patterns: {
                   ...prev.patterns,
                   [prev.currentPatternId]: updatedPattern,
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
                               // Use sendMIDI from the hook via ref
                               midiHookRef.current?.sendMIDI(deviceId, [0xB0 | midiChannel, 123, 0]); // All Notes Off CC
                          } catch(e) { console.warn("MIDI send error on unmute", e); }
                       }
                  }
             }

            const updatedTrack = { ...track, muted: !track.muted };
            const updatedPattern = {
              ...pattern,
              tracks: {
                ...pattern.tracks,
                [trackId]: updatedTrack,
              },
            };

            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [patternId]: updatedPattern,
                },
            };
        });
    }, []); // Removed sendMIDI dependency, using ref

   const handleTrackSelect = useCallback((trackId: string) => {
      setSequencerState(prev => ({ ...prev, currentTrackId: trackId, selectedStepId: null }));
   }, []);

    // Needs allNotesOff defined first
   const allNotesOff = useCallback((state: SequencerState, isPatternSwitch: boolean = false) => {
     console.log("Sending All Notes Off");
     Object.values(state.patterns).forEach(pattern => {
        Object.values(pattern.tracks).forEach(track => {
            const output = midiOutputsRef.current[track.id]; // Use cached output
            const deviceId = track.outputDeviceId;
            if (output && deviceId) { // Check if output port exists in cache
                const midiChannel = parseInt(track.midiChannel, 16);
                if (!isNaN(midiChannel) && midiChannel >= 0 && midiChannel <= 15) {
                    try {
                       // Use sendMIDI from the hook via ref
                       midiHookRef.current?.sendMIDI(deviceId, [0xB0 | midiChannel, 123, 0]);
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
          // sendLedUpdate(-1, state.ledOrder, state.ledTargetDeviceId); // Call sendLedUpdate directly here if needed
     }
   }, []); // Dependencies managed via refs or passed state

   const handlePatternSelect = useCallback((patternId: string) => {
       setSequencerState(prev => {
           if (!prev.patterns[patternId]) return prev;
            if (prev.isPlaying) {
               if (!prev.nextPatternQueue.includes(patternId) && patternId !== prev.currentPatternId) {
                   // Queue the pattern if playing and it's not already queued or current
                   return { ...prev, nextPatternQueue: [...prev.nextPatternQueue, patternId] };
               }
               return prev; // No change if already queued or current
            } else {
                // Switch immediately if stopped
                if (patternId === prev.currentPatternId) return prev; // No change if already current
                allNotesOff(prev); // Send all notes off before switching

                 const newPattern = prev.patterns[patternId];
                 // Select the first track of the new pattern, or keep current track if it exists in new pattern
                 const firstTrackId = Object.keys(newPattern.tracks)[0];
                 const newCurrentTrackId = newPattern.tracks[prev.currentTrackId] ? prev.currentTrackId : firstTrackId;

                 return {
                     ...prev,
                     currentPatternId: patternId,
                     nextPatternQueue: [], // Clear queue when switching manually
                     currentTrackId: newCurrentTrackId,
                     activeStepIndex: null, // Reset playback state
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

            // Copy track structure (not steps) from the current pattern
            const currentPattern = prev.patterns[prev.currentPatternId];
            if (currentPattern) {
                newPattern.tracks = {};
                Object.values(currentPattern.tracks).forEach(track => {
                    // Create a new initial track but copy config
                    const newTrack = createInitialTrack(track.trackNumber);
                     newTrack.outputDeviceId = track.outputDeviceId;
                     newTrack.midiChannel = track.midiChannel;
                     newTrack.name = track.name; // Copy name as well
                     // Don't copy steps, keep them default/empty
                    newPattern.tracks[newTrack.id] = newTrack;
                });
            }

           return {
               ...prev,
               patterns: {
                   ...prev.patterns,
                   [newPattern.id]: newPattern,
               },
                // Optionally select the new pattern immediately
                // currentPatternId: newPattern.id,
                // currentTrackId: Object.keys(newPattern.tracks)[0],
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
               // Deep copy using JSON stringify/parse
               const newPattern = JSON.parse(JSON.stringify(patternToCopy)) as Pattern;
               newPattern.id = newPatternId;
               newPattern.patternNumber = newPatternNum;
               newPattern.name = `Pattern ${newPatternNum + 1}`; // Give it a new default name
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
               // Select the first remaining pattern if the current one is deleted
               newCurrentPatternId = Object.keys(newPatterns)[0];
           }

            // Remove the deleted pattern from the queue
            const newQueue = prev.nextPatternQueue.filter(id => id !== patternIdToDelete);

             // Ensure the current track ID is valid for the potentially new current pattern
             const newCurrentPattern = newPatterns[newCurrentPatternId];
             let newCurrentTrackId = prev.currentTrackId;
              if (!newCurrentPattern || !newCurrentPattern.tracks[newCurrentTrackId]) {
                   // If track doesn't exist in new pattern, select the first track of that pattern
                  newCurrentTrackId = Object.keys(newCurrentPattern?.tracks ?? {})[0];
                   // If the new pattern somehow has no tracks (shouldn't happen with creation logic), create one
                   if (!newCurrentTrackId) {
                       const defaultTrack = createInitialTrack(0);
                       newPatterns[newCurrentPatternId].tracks[defaultTrack.id] = defaultTrack;
                       newCurrentTrackId = defaultTrack.id;
                   }
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
       currentStepRef.current = -1; // Reset step ref before starting worker
       timerWorkerRef.current?.postMessage({ cmd: 'start' });
       return { ...prev, isPlaying: true, activeStepIndex: -1 }; // Set activeStepIndex to -1 initially
   });
 }, []);

 const handleStop = useCallback(() => {
   setSequencerState(prev => {
      if (!prev.isPlaying) return prev;
       console.log("Stopping playback...");
       timerWorkerRef.current?.postMessage({ cmd: 'stop' });
       // Create a snapshot of the state *before* stopping for allNotesOff
       const stateBeforeStop = { ...prev };
       // Update state to reflect stopped status
       const stoppedState = { ...prev, isPlaying: false, activeStepIndex: null, nextPatternQueue: [] };
       // Call allNotesOff with the state *before* it was updated to stopped
       allNotesOff(stateBeforeStop, false);
       return stoppedState; // Return the updated stopped state
   });
 }, [allNotesOff]); // Add allNotesOff dependency


  const handleInputDeviceChange = useCallback((deviceId: string) => {
      setSequencerState(prev => {
          const newDeviceId = deviceId === 'none' ? undefined : deviceId;
          if(prev.selectedInputDeviceId === newDeviceId) return prev;

           // Attempt to find matching output device for LED control
           const selectedInputDevice = prev.midiInputDevices.find(d => d.id === newDeviceId);
           // Find output device with the same name as the selected input device
           const matchingOutputDevice = prev.midiOutputDevices.find(out => out.name === selectedInputDevice?.name);
           // Use the matching output device ID, or keep the existing LED target if no match found
           const newLedTargetId = matchingOutputDevice?.id ?? prev.ledTargetDeviceId;

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
           lastLearnedControl: null, // Reset last learned control when toggling
       }));
   }, []);

    const handleSaveMidiAssignments = useCallback((newAssignments: MidiAssignments) => {
       setSequencerState(prev => {
            // Ensure all stored assignment values are numbers or undefined
            const sanitizedAssignments = Object.entries(newAssignments).reduce((acc, [key, value]) => {
                acc[key as keyof MidiAssignments] = typeof value === 'number' && !isNaN(value) ? value : undefined;
                return acc;
            }, {} as MidiAssignments);

            // Derive ledOrder and trackSelectors from the sanitized assignments
            const newLedOrder = Object.entries(sanitizedAssignments)
                   .filter(([key, value]) => key.startsWith('setup_step') && typeof value === 'number') // Filter for defined step assignments
                   .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_step','')) - parseInt(keyB.replace('setup_step','')))
                   .map(([, value]) => value as number); // Map to CC numbers

            const newTrackSelectors = Object.entries(sanitizedAssignments)
                   .filter(([key, value]) => key.startsWith('setup_track') && typeof value === 'number') // Filter for defined track assignments
                   .sort(([keyA], [keyB]) => parseInt(keyA.replace('setup_track','')) - parseInt(keyB.replace('setup_track','')))
                   .map(([, value]) => value as number); // Map to CC numbers

           // Filter out undefined values and convert back to an object to match the SequencerState type
           const filteredAssignments: { [key: string]: number } = Object.fromEntries(
               Object.entries(sanitizedAssignments).filter(([, value]) => typeof value === 'number')
           ) as { [key: string]: number };

           return {
               ...prev,
               midiAssignments: filteredAssignments,
               ledOrder: newLedOrder,
               trackSelectors: newTrackSelectors,
               midiLearnActive: false, // Turn off learn mode after saving
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
            const clearedSteps = track.steps.map((step, index) => createInitialStep(index)); // Create new default steps

             const updatedTrack = { ...track, steps: clearedSteps };
             const updatedPattern = { ...pattern, tracks: { ...pattern.tracks, [trackId]: updatedTrack } };

            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [patternId]: updatedPattern
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
                 const clearedSteps = track.steps.map((step, index) => createInitialStep(index));
                acc[id] = { ...track, steps: clearedSteps };
                return acc;
            }, {} as { [trackId: string]: Track });

            const clearedPattern = { ...pattern, tracks: clearedTracks };

            return {
                ...prev,
                patterns: {
                    ...prev.patterns,
                    [patternId]: clearedPattern
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
                      // Example mapping (adjust range and sensitivity as needed)
                      // Map 0-127 to 60-300 BPM range (linear)
                      const newBpm = Math.round((velocityOrValue / 127) * (300 - 60)) + 60;
                      handleBpmChange(newBpm);
                      break;
                 case 'setup_swing':
                      // Map 0-127 to 0-75% swing range (linear)
                      const newSwing = Math.round((velocityOrValue / 127) * 75);
                      handleSwingChange(newSwing);
                      break;
                 case 'setup_pattern':
                      // Toggle pattern selection mode based on button press/release (value > 0)
                      return { ...prevState, changePatternMode: velocityOrValue > 0 };
                  case 'setup_copy':
                       // Activate paste mode based on button press/release (value > 0)
                      return { ...prevState, pasteActive: velocityOrValue > 0 };
                  case 'setup_clear':
                      if (velocityOrValue > 0) { // Only trigger on press (value > 0)
                          if (prevState.selectedStepId) {
                              // Clear selected step
                               handleStepToggle(prevState.selectedStepId, true); // Force clear
                          } else if (prevState.pasteActive) {
                              // Clear whole pattern if paste is active and no step selected
                              clearPattern(prevState.currentPatternId);
                          } else {
                               // Clear current track if paste is not active and no step selected
                               clearTrack(prevState.currentPatternId, prevState.currentTrackId);
                          }
                      }
                      break;
                  // --- Step/Track Selectors ---
                  default:
                      if (assignmentKey?.startsWith('setup_step')) {
                         const stepIndex = parseInt(assignmentKey.replace('setup_step', ''), 10) - 1;
                         if (stepIndex >= 0 && stepIndex < STEPS_PER_PATTERN && currentTrack) {
                              const stepId = currentTrack.steps[stepIndex].id; // Get ID from actual step object
                              if (velocityOrValue > 0) { // Button Press
                                  handleStepSelect(stepId);
                                  // If paste active, apply last note data to this step
                                  if(prevState.pasteActive && prevState.lastNoteData){
                                       handleStepToggle(stepId, false, prevState.lastNoteData);
                                  }
                              } else { // Button Release
                                  // Optional: Could deselect on release or implement step length adjustment
                              }
                          }
                      } else if (assignmentKey?.startsWith('setup_track')) {
                         const trackOrPatternIndex = parseInt(assignmentKey.replace('setup_track', ''), 10) - 1;
                         if (trackOrPatternIndex < 0) break; // Ignore invalid index

                         const isPatternMode = prevState.changePatternMode;

                         if (velocityOrValue > 0) { // Button Press
                            if (isPatternMode) {
                                // --- Pattern Mode ---
                                const patternId = `pattern${trackOrPatternIndex}`;
                                if (prevState.patterns[patternId]) {
                                    // Select existing pattern
                                    handlePatternSelect(patternId);
                                } else {
                                     // Optionally create and select a new pattern if it doesn't exist
                                     // handleAddPattern(trackOrPatternIndex);
                                     // handlePatternSelect(patternId);
                                    console.log(`Attempted to select non-existent pattern ${trackOrPatternIndex + 1}`);
                                }
                            } else { // --- Track Mode ---
                                const trackId = `track${trackOrPatternIndex}`;
                                if (currentPattern?.tracks[trackId]) {
                                    // Select existing track
                                    if (prevState.pasteActive) { // Mute toggle in paste mode
                                        toggleTrackMute(currentPattern.id, trackId);
                                    } else {
                                        handleTrackSelect(trackId);
                                    }
                                } else {
                                    // Create new track and select it if it doesn't exist
                                     handleAddTrack(trackOrPatternIndex);
                                     // Need to wait for state update, maybe select in a follow-up effect?
                                     // For now, just create it. Selection might need adjustment.
                                     // handleTrackSelect(`track${trackOrPatternIndex}`); // This might select before state updates
                                     // Consider selecting in handleAddTrack's completion toast or using useEffect
                                }
                            }
                        } else { // Button Release
                            // Optional: Reset flags or handle release actions
                         }
                     }
                 // --- Note Parameter Controls (apply to selected step or last note data) ---
                     else {
                           let targetStepId = prevState.selectedStepId;
                           let applyToLastNote = false;

                            // If no step is selected, potentially modify the lastNoteData for pasting
                            if (!targetStepId && prevState.pasteActive) {
                                targetStepId = null; // Explicitly null
                                applyToLastNote = true;
                            }

                          if (targetStepId || applyToLastNote) {
                               let changes: Partial<Step> = {};
                               let newLastNoteData = {...prevState.lastNoteData};

                               switch (assignmentKey) {
                                   case 'setup_notepitch':
                                        // Map 0-127 CC value to a MIDI note range (e.g., 0-127)
                                        const notePitch = velocityOrValue; // Direct mapping for now
                                        changes = { notePitch };
                                        newLastNoteData = {...newLastNoteData, notePitch };
                                       break;
                                   case 'setup_velocity':
                                       // Use the CC value directly as velocity
                                       changes = { velocity: velocityOrValue };
                                       newLastNoteData = {...newLastNoteData, velocity: changes.velocity };
                                       break;
                                    case 'setup_notelength':
                                         // Map 0-127 CC value to note length (e.g., 1-16 steps)
                                        const length = Math.max(1, Math.min(STEPS_PER_PATTERN, Math.round((velocityOrValue / 127) * (STEPS_PER_PATTERN -1)) + 1));
                                        changes = { noteLength: length };
                                        newLastNoteData = {...newLastNoteData, noteLength: changes.noteLength };
                                        break;
                               }

                                if (Object.keys(changes).length > 0) {
                                   if (applyToLastNote) {
                                       // Update only lastNoteData
                                        return { ...prevState, lastNoteData: newLastNoteData };
                                   } else if (targetStepId) {
                                       // Apply changes to the selected step and update lastNoteData
                                        const pattern = prevState.patterns[prevState.currentPatternId];
                                        const track = pattern?.tracks[prevState.currentTrackId];
                                        if (!track) return prevState;

                                        // Ensure the step is enabled when modifying its parameters
                                        const currentStep = track.steps.find(s => s.id === targetStepId);
                                        changes.enabled = true;
                                        changes.velocity = changes.velocity ?? currentStep?.velocity ?? DEFAULT_VELOCITY;
                                        changes.noteLength = changes.noteLength ?? currentStep?.noteLength ?? DEFAULT_NOTE_LENGTH;
                                        changes.notePitch = changes.notePitch ?? currentStep?.notePitch ?? 60; // Default pitch if setting others

                                        const newSteps = track.steps.map(step =>
                                          step.id === targetStepId ? { ...step, ...changes } : step
                                        );

                                        const updatedTrack = { ...track, steps: newSteps };
                                        const updatedPattern = { ...pattern, tracks: { ...pattern.tracks, [prevState.currentTrackId]: updatedTrack } };

                                        return {
                                           ...prevState,
                                           patterns: {
                                             ...prevState.patterns,
                                             [prevState.currentPatternId]: updatedPattern,
                                           },
                                           lastNoteData: newLastNoteData, // Update lastNoteData reflecting the change
                                        };
                                   }
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
                   if (!currentStep) return prevState;

                   const changes: Partial<Step> = {
                       notePitch,
                       velocity,
                       enabled: true, // Ensure step is enabled
                       noteLength: currentStep.noteLength ?? DEFAULT_NOTE_LENGTH, // Keep existing length or default
                   };
                   const newLastNoteData = {notePitch: changes.notePitch, velocity: changes.velocity, noteLength: changes.noteLength};

                    // Directly update state here
                    const pattern = prevState.patterns[prevState.currentPatternId];
                    if (!pattern) return prevState;
                    const track = pattern.tracks[prevState.currentTrackId];
                     if (!track) return prevState;

                    const newSteps = track.steps.map(step =>
                      step.id === prevState.selectedStepId ? { ...step, ...changes } : step
                    );
                    const updatedTrack = { ...track, steps: newSteps };
                    const updatedPattern = { ...pattern, tracks: { ...pattern.tracks, [prevState.currentPatternId]: updatedTrack } };

                    return {
                       ...prevState,
                       patterns: {
                         ...prevState.patterns,
                         [prevState.currentPatternId]: updatedPattern,
                       },
                       lastNoteData: newLastNoteData, // Update last note data
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

   // --- Effect for updating device lists and output cache ---
   useEffect(() => {
       setSequencerState(prev => {
           // Basic check to see if device lists have actually changed references
           const inputsChanged = prev.midiInputDevices !== inputDevices;
           const outputsChanged = prev.midiOutputDevices !== outputDevices;

           if (!inputsChanged && !outputsChanged) {
               return prev; // No change needed
           }

           // Determine selected input and LED target based on new lists
           const firstInputId = inputDevices[0]?.id;
           // Keep existing selection if possible, otherwise fallback to first input
           const selectedInputId = inputDevices.some(d => d.id === prev.selectedInputDeviceId)
               ? prev.selectedInputDeviceId
               : firstInputId;

            // Update LED target only if input devices changed or selection changed
            let newLedTargetId = prev.ledTargetDeviceId;
            if (inputsChanged || selectedInputId !== prev.selectedInputDeviceId) {
                const selectedInputDevice = inputDevices.find(d => d.id === selectedInputId);
                const matchingOutputDevice = outputDevices.find(out => out.name === selectedInputDevice?.name);
                newLedTargetId = matchingOutputDevice?.id ?? undefined; // Fallback to undefined if no match
            }


           return {
               ...prev,
               midiInputDevices: inputDevices,
               midiOutputDevices: outputDevices,
               selectedInputDeviceId: selectedInputId,
               ledTargetDeviceId: newLedTargetId,
           };
       });
   }, [inputDevices, outputDevices]); // Only depend on the device lists from useMIDI


   // --- Effect for updating the MIDI output cache ---
   useEffect(() => {
       const localGetOutputPortById = midiHookRef.current?.getOutputPortById;
       if (!localGetOutputPortById || !outputDevices.length) {
            // If MIDI is not ready or no output devices, clear the cache
            if (Object.keys(midiOutputsRef.current).length > 0) {
                midiOutputsRef.current = {};
            }
            return;
        }

       const newOutputsCache: { [trackId: string]: MIDIOutput | undefined } = {};
       let cacheChanged = false;

       Object.values(sequencerState.patterns).forEach(pattern => {
           Object.values(pattern.tracks).forEach(track => {
               let cachedPort = midiOutputsRef.current[track.id];
               let newPort: MIDIOutput | undefined = undefined;

               if (track.outputDeviceId) {
                   newPort = localGetOutputPortById(track.outputDeviceId);
                   if (!newPort) {
                       // Device specified but not found (maybe disconnected?)
                       console.warn(`Track ${track.name}: Output device ${track.outputDeviceId} not found.`);
                   }
               }
                newOutputsCache[track.id] = newPort;

                // Detect if the port for this track has changed
                if (cachedPort !== newPort) {
                    cacheChanged = true;
                }
           });
       });

        // Also check if any tracks were removed from the cache
        if (!cacheChanged) {
            for (const trackId in midiOutputsRef.current) {
                if (!newOutputsCache.hasOwnProperty(trackId)) {
                    cacheChanged = true;
                    break;
                }
            }
        }


       // Only update the ref if the cache content has actually changed
       if (cacheChanged) {
           console.log("Updating MIDI output cache:", newOutputsCache);
           midiOutputsRef.current = newOutputsCache;
       }

   // Depend on patterns (for track definitions) and outputDevices (for available ports)
   }, [sequencerState.patterns, outputDevices]);



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
           // --- Create Default Initial State ---
           const defaultInitialPattern = createInitialPattern(0);
           const defaultInitialState: SequencerState = {
               patterns: { [defaultInitialPattern.id]: defaultInitialPattern },
               currentPatternId: defaultInitialPattern.id,
               nextPatternQueue: [],
               currentTrackId: defaultInitialPattern.tracks['track0'].id,
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

           // --- Merge Loaded State with Defaults ---
           const mergedState: SequencerState = {
               ...defaultInitialState, // Start with defaults
               ...loadedState, // Overwrite with loaded values
               // --- Crucially, DO NOT overwrite hardware/runtime state ---
               midiInputDevices: prev.midiInputDevices, // Keep current devices from hook
               midiOutputDevices: prev.midiOutputDevices, // Keep current devices from hook
               isPlaying: false, // Always start stopped
               activeStepIndex: null, // Always start inactive
               lastLearnedControl: null, // Don't persist temporary learn state
               midiLearnActive: false, // Don't start in learn mode
               // --- Sanitize and Validate Loaded Data ---
               patterns: loadedState.patterns && Object.keys(loadedState.patterns).length > 0
                   ? loadedState.patterns
                   : defaultInitialState.patterns, // Fallback if patterns are missing/empty
               // Sanitize and filter loaded midiAssignments to match the SequencerState type
               midiAssignments: Object.entries(loadedState.midiAssignments || {}).reduce((acc, [key, value]) => {
                   if (typeof value === 'number') {
                       acc[key] = value;
                   }
                   return acc;
               }, {} as { [key: string]: number }),
               ledOrder: Array.isArray(loadedState.ledOrder) ? loadedState.ledOrder.filter(n => typeof n === 'number') : [],
               trackSelectors: Array.isArray(loadedState.trackSelectors) ? loadedState.trackSelectors.filter(n => typeof n === 'number') : [],
           };

             // --- Ensure current IDs are valid ---
             if (!mergedState.patterns[mergedState.currentPatternId]) {
                 mergedState.currentPatternId = Object.keys(mergedState.patterns)[0];
             }
             const currentPattern = mergedState.patterns[mergedState.currentPatternId];
             if (!currentPattern.tracks[mergedState.currentTrackId]) {
                 mergedState.currentTrackId = Object.keys(currentPattern.tracks)[0];
             }

             // --- Re-initialize MIDI Output Cache based on loaded state ---
              const localGetOutputPortById = midiHookRef.current?.getOutputPortById;
              if (localGetOutputPortById) {
                   const initialCache: { [trackId: string]: MIDIOutput | undefined } = {};
                   Object.values(mergedState.patterns).forEach(p => {
                       Object.values(p.tracks).forEach(t => {
                           if (t.outputDeviceId) {
                               initialCache[t.id] = localGetOutputPortById(t.outputDeviceId);
                           }
                       });
                   });
                   midiOutputsRef.current = initialCache;
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
         // midiLearnActive is also transient
         delete (stateToSave as Partial<SequencerState>).midiLearnActive;

        localStorage.setItem('sequencerState', JSON.stringify(stateToSave));
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
             // Turn off all LEDs first (more reliable than tracking individual states)
             for (let i = 0; i < ledOrder.length; i++) {
                 const ledCC = ledOrder[i];
                 if (ledCC !== undefined) {
                     // Use sendMIDI via ref
                     midiHookRef.current?.sendMIDI(targetDeviceId, [0xB0, ledCC, 0]); // Assuming channel 1 (0xB0), Value 0=Off
                 }
             }
             // Turn on the active LED
             if (activeIndex >= 0 && activeIndex < ledOrder.length) {
                const activeLedCC = ledOrder[activeIndex];
                if (activeLedCC !== undefined) {
                    // Use sendMIDI via ref
                     midiHookRef.current?.sendMIDI(targetDeviceId, [0xB0, activeLedCC, 127]); // Value 127=On
                 }
             }
         } catch(e){
            console.warn(`Failed to send LED update to ${targetDeviceId}`, e);
         }
    }, []); // Removed sendMIDI dependency


  // --- Playback Logic ---
   const playStep = useCallback((stepIndex: number, state: SequencerState) => {
       const pattern = state.patterns[state.currentPatternId];
       if (!pattern) return;

       // --- LED Feedback ---
       // Call sendLedUpdate directly here
       sendLedUpdate(stepIndex, state.ledOrder, state.ledTargetDeviceId);

       // --- Note On/Off Logic ---
       Object.values(pattern.tracks).forEach(track => {
           if (track.muted) return;

           const step = track.steps[stepIndex];
           const output = midiOutputsRef.current[track.id]; // Use cached output
           const midiChannel = parseInt(track.midiChannel, 16);

           if (!output || isNaN(midiChannel) || midiChannel < 0 || midiChannel > 15 || !track.outputDeviceId) return;

           const noteOnCmd = 0x90 | midiChannel;
           const noteOffCmd = 0x80 | midiChannel;
           const currentTranspose = track.transpose || 0;

           // --- Handle Note Offs ---
            if (!activeNotesRef.current[track.id]) activeNotesRef.current[track.id] = {};
            const activeTrackNotes = activeNotesRef.current[track.id];
            // Iterate over a copy of keys to avoid issues if deleting while iterating
            const notesToCheckOff = Object.keys(activeTrackNotes).map(n => parseInt(n));

            notesToCheckOff.forEach(notePitch => {
                const startStepIndex = activeTrackNotes[notePitch];
                 // Check if note still exists in the map (might have been turned off already)
                 if (startStepIndex === undefined) return;

                 // Find the step definition that started this note
                 const noteDef = track.steps[startStepIndex];
                 if (!noteDef || noteDef.notePitch === undefined) {
                     // If the original step definition is gone or invalid, turn off the note anyway
                     console.warn(`Turning off note ${notePitch} for track ${track.id} due to missing definition at step ${startStepIndex}`);
                      try {
                           midiHookRef.current?.sendMIDI(track.outputDeviceId!, [noteOffCmd, notePitch, 0]);
                      } catch (e) { console.warn(`MIDI Send Error (Note Off ${notePitch}):`, e); }
                     delete activeTrackNotes[notePitch];
                     return;
                 }

                 const noteLength = noteDef.noteLength ?? 1;
                // Calculate when the note should end. + noteLength means it plays FOR noteLength steps.
                const endStepIndex = (startStepIndex + noteLength) % STEPS_PER_PATTERN;

                // If the current step is the one where the note should end
                if (endStepIndex === stepIndex) {
                    try {
                        // Use sendMIDI via ref
                        midiHookRef.current?.sendMIDI(track.outputDeviceId!, [noteOffCmd, notePitch, 0]);
                    } catch (e) { console.warn(`MIDI Send Error (Note Off ${notePitch}):`, e); }
                    delete activeTrackNotes[notePitch]; // Remove from active notes
                }
           });


           // --- Handle Note Ons ---
           if (step.enabled && step.notePitch !== undefined) {
               const pitch = step.notePitch + currentTranspose;
               const velocity = step.velocity ?? DEFAULT_VELOCITY;
                if (pitch >= 0 && pitch <= 127) {
                     // Check if this exact note is already playing for this track
                     if (activeTrackNotes[pitch] !== undefined) {
                         // Send Note Off for the existing note before starting a new one (re-trigger)
                         console.log(`Re-triggering note ${pitch} on track ${track.id}`);
                         try {
                             midiHookRef.current?.sendMIDI(track.outputDeviceId!, [noteOffCmd, pitch, 0]);
                         } catch (e) { console.warn(`MIDI Send Error (Note Off for re-trigger ${pitch}):`, e); }
                         delete activeTrackNotes[pitch]; // Remove old entry
                     }

                    try {
                        // Use sendMIDI via ref
                        midiHookRef.current?.sendMIDI(track.outputDeviceId!, [noteOnCmd, pitch, velocity]);
                        activeTrackNotes[pitch] = stepIndex; // Record which step started this note
                    } catch (e) { console.warn(`MIDI Send Error (Note On ${pitch}):`, e); }
                }
           }
       });
   }, [sendLedUpdate]); // Include sendLedUpdate dependency, sendMIDI is via ref


  // --- Web Worker Timer ---
  useEffect(() => {
    timerWorkerRef.current = new Worker(new URL('../workers/timerWorker.ts', import.meta.url));
    let localIsPlaying = false; // Track worker's playing state locally

    timerWorkerRef.current.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'tick') {
        // Use functional update to get the latest state for playStep
        setSequencerState(prev => {
            // Double-check if still playing according to the state
            if (!prev.isPlaying) {
                 // If state says stopped but worker ticked, stop the worker
                 console.warn("Worker ticked while sequencer state is stopped. Stopping worker.");
                 timerWorkerRef.current?.postMessage({ cmd: 'stop' });
                 localIsPlaying = false;
                 // Ensure notes are off if worker was out of sync
                 allNotesOff(prev, false);
                 return { ...prev, activeStepIndex: null }; // Ensure visual update
            }
            localIsPlaying = true; // Mark that the worker is actively playing

            // Ensure currentPatternId is valid
            const currentPatternId = prev.patterns[prev.currentPatternId]
                ? prev.currentPatternId
                : Object.keys(prev.patterns)[0] || null;

            if (!currentPatternId) {
                 console.error("No valid pattern found during playback tick.");
                 // Stop playback if no pattern exists
                 timerWorkerRef.current?.postMessage({ cmd: 'stop' });
                 localIsPlaying = false;
                 allNotesOff(prev, false);
                 return { ...prev, isPlaying: false, activeStepIndex: null };
            }

            const newActiveStepIndex = e.data.step;
            playStep(newActiveStepIndex, prev); // Call playStep with the latest state

             // --- Pattern Switching Logic ---
             let nextPatternId = currentPatternId;
             let nextQueue = [...prev.nextPatternQueue];
             // Switch pattern at the *end* of the current pattern (step 15 about to tick to 0)
             if (newActiveStepIndex === STEPS_PER_PATTERN - 1 && nextQueue.length > 0) {
                nextPatternId = nextQueue.shift()!; // Get and remove next pattern from queue
                allNotesOff(prev, true); // Send notes off for pattern switch
                 console.log(`Switching to pattern: ${nextPatternId}`);
             }

            return {
                ...prev,
                activeStepIndex: newActiveStepIndex,
                currentPatternId: nextPatternId, // Update current pattern if switched
                nextPatternQueue: nextQueue, // Update queue
            };
        });
      }
    };

     // Initialize worker with current BPM and Swing
     timerWorkerRef.current.postMessage({ cmd: 'bpm', value: sequencerState.bpm });
     timerWorkerRef.current.postMessage({ cmd: 'swing', value: sequencerState.swing });

    return () => {
      console.log("Terminating timer worker");
      timerWorkerRef.current?.postMessage({ cmd: 'stop' });
      timerWorkerRef.current?.terminate();
      timerWorkerRef.current = null;

      // Send All Notes Off using the *final* state before unmount
      // Use a functional update to access the latest state if needed,
      // but since this is cleanup, the last known state might be sufficient.
      // However, accessing state directly here might be stale.
      // A safer approach might be less reliant on state within cleanup.
       if (localIsPlaying) {
           // We need a reliable way to get the final state here.
           // Using a ref for the state might be one way, or relying on the `allNotesOff`
           // function's internal logic if it uses refs correctly.
           // For simplicity, we assume `allNotesOff` can handle potentially stale state
           // by iterating through known outputs, or we accept a small risk.

            // Call allNotesOff directly. It uses midiOutputsRef which should be up-to-date.
             allNotesOff(sequencerState, false); // Pass the last known state
       }
       activeNotesRef.current = {}; // Clear active notes ref
    };
  // Re-run setup if bpm or swing changes externally (though handled by messages now)
  // playStep and allNotesOff are stable callbacks due to useCallback/useRef
  }, [playStep, allNotesOff, sequencerState.bpm, sequencerState.swing]);


   // --- Effect for Control LED Updates ---
    const updateControlLEDs = useCallback((state: SequencerState) => {
         const localGetOutputPortById = midiHookRef.current?.getOutputPortById; // Get from ref
         if (!state.ledTargetDeviceId || !state.trackSelectors || !localGetOutputPortById) return;
         const targetOutput = localGetOutputPortById(state.ledTargetDeviceId);
         if (!targetOutput) return;

         const send = (cc: number | undefined, value: number) => {
            if (cc !== undefined) {
                try {
                   midiHookRef.current?.sendMIDI(state.ledTargetDeviceId!, [0xB0, cc, value]); // Channel 1 CC
                } catch (e) { console.warn("LED send error", e); }
            }
         }

         try {
             // Turn off all track/pattern selector LEDs first
             state.trackSelectors.forEach(cc => send(cc, 0));
              // Turn off the pattern mode toggle LED
             send(state.midiAssignments.setup_pattern, 0);

              // Determine the active LED based on mode
              if (state.changePatternMode) {
                  // Pattern Mode: Light up the pattern mode toggle and the current pattern's LED
                 send(state.midiAssignments.setup_pattern, 127); // Turn on pattern mode LED

                  const patternIndex = state.patterns[state.currentPatternId]?.patternNumber ?? -1;
                   if (patternIndex >= 0 && patternIndex < state.trackSelectors.length) {
                       const patternLedCC = state.trackSelectors[patternIndex];
                       send(patternLedCC, 127); // Turn on current pattern LED
                   }
              } else {
                  // Track Mode: Light up the current track's LED
                  const trackIndex = state.patterns[state.currentPatternId]?.tracks[state.currentTrackId]?.trackNumber ?? -1;
                  if (trackIndex >= 0 && trackIndex < state.trackSelectors.length) {
                     const trackLedCC = state.trackSelectors[trackIndex];
                      send(trackLedCC, 127); // Turn on current track LED
                  }
              }
          } catch (e) {
             console.warn(`Failed to send control LED update to ${state.ledTargetDeviceId}`, e);
          }
    }, []); // Dependencies managed via refs or passed state

    // Run updateControlLEDs whenever relevant state pieces change
    useEffect(() => {
        updateControlLEDs(sequencerState);
    }, [
        sequencerState.currentPatternId,
        sequencerState.currentTrackId,
        sequencerState.changePatternMode,
        sequencerState.ledTargetDeviceId, // Re-run if target device changes
        sequencerState.patterns, // Needed to map IDs to indices
        sequencerState.midiAssignments.setup_pattern, // If the pattern CC changes
        sequencerState.trackSelectors, // If the track selector CCs change
        updateControlLEDs // Include the function itself
    ]);


  // --- Return Values ---
   // Memoize current pattern and track derivation to prevent unnecessary re-renders downstream
   const currentPattern = useMemo(() => {
        return sequencerState.patterns[sequencerState.currentPatternId] ?? Object.values(sequencerState.patterns)[0] ?? createInitialPattern(0);
   }, [sequencerState.patterns, sequencerState.currentPatternId]);

   const currentTrack = useMemo(() => {
       const patternTracks = currentPattern?.tracks ?? {};
       return patternTracks[sequencerState.currentTrackId] ?? Object.values(patternTracks)[0] ?? createInitialTrack(0);
   }, [currentPattern, sequencerState.currentTrackId]);


   // Use useMemo for actions object to ensure stable reference
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
      // Bind context-dependent actions
     clearTrack: (trackId: string) => clearTrack(sequencerState.currentPatternId, trackId),
     clearPattern: () => clearPattern(sequencerState.currentPatternId),
     toggleTrackMute: (trackId: string) => toggleTrackMute(sequencerState.currentPatternId, trackId),
   }), [
       handleStepToggle, handleStepSelect, handleTrackChange, handleAddTrack, handleDeleteTrack,
       handleTrackSelect, handlePatternSelect, handleAddPattern, handleCopyPattern, handleDeletePattern,
       handleBpmChange, handleSwingChange, handlePlay, handleStop, handleInputDeviceChange,
       handleToggleMidiLearn, handleSaveMidiAssignments, clearTrack, clearPattern, toggleTrackMute,
       sequencerState.currentPatternId // Include currentPatternId as it's used in bound actions
   ]);


  return {
    sequencerState,
    currentPattern,
    currentTrack,
    midiError,
    actions,
  };
}
