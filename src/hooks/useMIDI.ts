
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MIDIDevice, MIDIMessageEvent } from '@/types/sequencer';

interface MIDIProps {
  onMessage?: (event: MIDIMessageEvent) => void;
}

interface MIDIAccessExtended extends MIDIAccess {
  inputs: Map<string, MIDIInput>;
  outputs: Map<string, MIDIOutput>;
}


export function useMIDI({ onMessage }: MIDIProps = {}) {
  const [midiAccess, setMidiAccess] = useState<MIDIAccessExtended | null>(null);
  const [inputDevices, setInputDevices] = useState<MIDIDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<MIDIDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onMessageRef = useRef(onMessage); // Ref to hold the latest onMessage callback

   // Update ref whenever onMessage changes
   useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);


  const handleStateChange = useCallback(() => {
    if (midiAccess) {
      console.log("MIDI state changed, updating devices...");
      updateDevices(midiAccess);
    }
  }, [midiAccess]);

  const handleMIDIMessage = useCallback((event: Event) => {
       // Type assertion needed because the default Event type doesn't have 'data' or 'srcElement'
        const midiEvent = event as unknown as MIDIMessageEvent & { target: MIDIInput };
        // console.log('MIDI Message received in hook:', midiEvent.data, 'from:', midiEvent.target?.id);

         if (onMessageRef.current) {
             // Construct the simplified event structure expected by the handler
             const simplifiedEvent: MIDIMessageEvent = {
                 data: midiEvent.data,
                 receivedTime: midiEvent.receivedTime,
                 // Find the device ID from the target
                 srcElement: { id: midiEvent.target?.id || 'unknown' },
             };
             onMessageRef.current(simplifiedEvent);
         }

  }, []); // Dependencies are managed via onMessageRef


  const updateDevices = useCallback((access: MIDIAccessExtended) => {
    const inputs: MIDIDevice[] = [];
    access.inputs.forEach((input) => {
      inputs.push({ id: input.id, name: input.name || `Input ${input.id}`, type: 'input' });
       // Remove old listener before adding new one
       input.removeEventListener('midimessage', handleMIDIMessage);
       input.addEventListener('midimessage', handleMIDIMessage);
    });
    setInputDevices(inputs);
     // console.log("Input devices updated:", inputs);


    const outputs: MIDIDevice[] = [];
    access.outputs.forEach((output) => {
      outputs.push({ id: output.id, name: output.name || `Output ${output.id}`, type: 'output' });
    });
    setOutputDevices(outputs);
     // console.log("Output devices updated:", outputs);

  }, [handleMIDIMessage]); // Add handleMIDIMessage dependency

  useEffect(() => {
    const requestMIDIAccess = async () => {
      if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
        try {
          // Request SysEx access if needed, but be cautious
          const access = await navigator.requestMIDIAccess({ sysex: false }) as MIDIAccessExtended;
          console.log('MIDI Access Granted');
          setMidiAccess(access);
          updateDevices(access);

          // Listen for device connection changes
          access.addEventListener('statechange', handleStateChange);

        } catch (err) {
          console.error('Failed to get MIDI access', err);
          setError(`Failed to get MIDI access: ${err instanceof Error ? err.message : String(err)}.\n Ensure you are using a secure connection (HTTPS) and have granted MIDI permissions.`);
        }
      } else {
        setError('Web MIDI API is not supported in this browser.');
         console.warn('Web MIDI API not supported');
      }
    };

    requestMIDIAccess();

    // Cleanup function
    return () => {
      if (midiAccess) {
        console.log("Cleaning up MIDI listeners...");
         midiAccess.removeEventListener('statechange', handleStateChange);
        // Remove message listeners from all inputs
        midiAccess.inputs.forEach((input) => {
          input.removeEventListener('midimessage', handleMIDIMessage);
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount


  const sendMIDI = useCallback((deviceId: string, data: number[] | Uint8Array) => {
    const output = midiAccess?.outputs.get(deviceId);
    if (output) {
       // console.log(`Sending MIDI to ${deviceId}:`, data);
      output.send(data);
    } else {
      console.warn(`Output device ${deviceId} not found.`);
    }
  }, [midiAccess]);

  const getInputPortById = (id: string): MIDIInput | undefined => {
    return midiAccess?.inputs.get(id);
  };

   const getOutputPortById = (id: string): MIDIOutput | undefined => {
    return midiAccess?.outputs.get(id);
  };


  return { midiAccess, inputDevices, outputDevices, sendMIDI, getInputPortById, getOutputPortById, error };
}
