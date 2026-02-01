/**
 * usePlayback Hook - Manages sequencer playback
 * 
 * Handles:
 * - Play/stop controls
 * - BPM and swing changes
 * - Step progression
 * - Pattern transitions
 * - LED feedback
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSequencerStore, selectCurrentPattern } from '@/stores/sequencerStore';
import { playbackService } from '@/services/playbackService';
import { midiService } from '@/services/midiService';

export function usePlayback() {
  const store = useSequencerStore();
  const currentPattern = useSequencerStore(selectCurrentPattern);
  
  // Refs for accessing latest state in callbacks
  const stateRef = useRef(store);
  stateRef.current = store;

  // Initialize playback service
  useEffect(() => {
    playbackService.initialize();
    
    return () => {
      playbackService.dispose();
    };
  }, []);

  // Sync BPM and swing with playback service
  useEffect(() => {
    playbackService.setBpm(store.bpm);
  }, [store.bpm]);

  useEffect(() => {
    playbackService.setSwing(store.swing);
  }, [store.swing]);

  // Update playback service when pattern changes
  useEffect(() => {
    if (currentPattern) {
      playbackService.updatePattern(currentPattern);
    }
  }, [currentPattern]);

  // Handle playback callbacks
  useEffect(() => {
    if (!store.isPlaying) return;

    // Queue pattern if needed
    if (store.nextPatternQueue.length > 0) {
      playbackService.queuePattern(store.nextPatternQueue[0]);
    }
  }, [store.isPlaying, store.nextPatternQueue]);

  const play = useCallback(() => {
    if (!currentPattern) return;

    const result = playbackService.start(currentPattern, {
      onStep: (step) => {
        store.setActiveStep(step);
        
        // Update step LEDs
        if (stateRef.current.ledTargetDeviceId) {
          midiService.updateStepLEDs(
            stateRef.current.ledTargetDeviceId,
            stateRef.current.ledOrder,
            step
          );
        }
      },
      onPatternChange: (patternId) => {
        store.selectPattern(patternId);
      },
      onError: (error) => {
        console.error('Playback error:', error);
        store.stop();
      },
    });

    if (result.success) {
      store.play();
    } else {
      console.error('Failed to start playback:', result.error);
    }
  }, [currentPattern, store]);

  const stop = useCallback(() => {
    const result = playbackService.stop();
    
    if (result.success) {
      store.stop();
      
      // Clear step LEDs
      if (store.ledTargetDeviceId) {
        midiService.clearAllLEDs(store.ledTargetDeviceId, store.ledOrder);
      }
    }
  }, [store]);

  const togglePlayback = useCallback(() => {
    if (store.isPlaying) {
      stop();
    } else {
      play();
    }
  }, [store.isPlaying, play, stop]);

  return {
    isPlaying: store.isPlaying,
    currentStep: store.activeStepIndex,
    bpm: store.bpm,
    swing: store.swing,
    play,
    stop,
    togglePlayback,
    setBpm: store.setBpm,
    setSwing: store.setSwing,
  };
}

export default usePlayback;
