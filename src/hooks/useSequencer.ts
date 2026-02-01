/**
 * useSequencer Hook - Main sequencer hook that composes all functionality
 * 
 * This is the primary hook used by the page component. It provides a clean
 * interface to all sequencer functionality by composing smaller, focused hooks.
 */

import { useCallback, useMemo } from 'react';
import { useSequencerStore, selectCurrentPattern, selectCurrentTrack, selectPatternList, selectTrackList } from '@/stores/sequencerStore';
import { usePlayback } from './usePlayback';
import { useMIDIController } from './useMIDIController';
import { usePersistence } from './usePersistence';

export function useSequencer() {
  // Get store state - use a single selector to avoid multiple subscriptions
  const store = useSequencerStore();
  
  // Use memoized selectors to prevent infinite loops
  const currentPattern = useMemo(() => selectCurrentPattern(store), [store.patterns, store.currentPatternId]);
  const currentTrack = useMemo(() => selectCurrentTrack(store), [store.patterns, store.currentPatternId, store.currentTrackId]);
  const patterns = useMemo(() => selectPatternList(store), [store.patterns]);
  const tracks = useMemo(() => selectTrackList(store), [store.patterns, store.currentPatternId]);

  // Compose functionality from focused hooks
  const playback = usePlayback();
  const midi = useMIDIController();
  const persistence = usePersistence();

  // Pattern actions
  const patternActions = useMemo(() => ({
    add: store.addPattern,
    delete: store.deletePattern,
    select: store.selectPattern,
    copy: store.copyPattern,
    queue: store.queuePattern,
    clearQueue: store.clearPatternQueue,
  }), [store]);

  // Track actions
  const trackActions = useMemo(() => ({
    add: store.addTrack,
    delete: store.deleteTrack,
    select: store.selectTrack,
    update: store.updateTrack,
    toggleMute: store.toggleTrackMute,
    clear: store.clearTrack,
  }), [store]);

  // Step actions
  const stepActions = useMemo(() => ({
    toggle: store.toggleStep,
    select: store.selectStep,
    update: store.updateStep,
    clearAll: store.clearAllSteps,
  }), [store]);

  // UI actions
  const uiActions = useMemo(() => ({
    setChangePatternMode: store.setChangePatternMode,
    setPasteActive: store.setPasteActive,
    setTransposeMode: store.setTransposeMode,
    setTransposeValue: store.setTransposeValue,
  }), [store]);

  // Combined state for components
  const sequencerState = useMemo(() => ({
    // Pattern state
    patterns,
    currentPattern,
    currentPatternId: store.currentPatternId,
    nextPatternQueue: store.nextPatternQueue,
    
    // Track state
    tracks,
    currentTrack,
    currentTrackId: store.currentTrackId,
    
    // Playback state
    isPlaying: playback.isPlaying,
    currentStep: playback.currentStep,
    bpm: playback.bpm,
    swing: playback.swing,
    
    // Step state
    selectedStepId: store.selectedStepId,
    
    // UI state
    changePatternMode: store.changePatternMode,
    pasteActive: store.pasteActive,
    transposeModeActive: store.transposeModeActive,
    currentTransposeValue: store.currentTransposeValue,
    
    // MIDI state
    midiInputDevices: midi.inputDevices,
    midiOutputDevices: midi.outputDevices,
    selectedInputDeviceId: midi.selectedInputDeviceId,
    midiLearnActive: midi.midiLearnActive,
    lastLearnedControl: midi.lastLearnedControl,
    midiAssignments: midi.midiAssignments,
  }), [
    patterns,
    currentPattern,
    store.currentPatternId,
    store.nextPatternQueue,
    tracks,
    currentTrack,
    store.currentTrackId,
    playback.isPlaying,
    playback.currentStep,
    playback.bpm,
    playback.swing,
    store.selectedStepId,
    store.changePatternMode,
    store.pasteActive,
    store.transposeModeActive,
    store.currentTransposeValue,
    midi.inputDevices,
    midi.outputDevices,
    midi.selectedInputDeviceId,
    midi.midiLearnActive,
    midi.lastLearnedControl,
    midi.midiAssignments,
  ]);

  // Combined actions for components
  const actions = useMemo(() => ({
    // Playback
    play: playback.play,
    stop: playback.stop,
    togglePlayback: playback.togglePlayback,
    setBpm: playback.setBpm,
    setSwing: playback.setSwing,
    
    // Patterns
    addPattern: patternActions.add,
    deletePattern: patternActions.delete,
    selectPattern: patternActions.select,
    copyPattern: patternActions.copy,
    queuePattern: patternActions.queue,
    clearPatternQueue: patternActions.clearQueue,
    
    // Tracks
    addTrack: trackActions.add,
    deleteTrack: trackActions.delete,
    selectTrack: trackActions.select,
    updateTrack: trackActions.update,
    toggleTrackMute: trackActions.toggleMute,
    clearTrack: trackActions.clear,
    
    // Steps
    toggleStep: stepActions.toggle,
    selectStep: stepActions.select,
    updateStep: stepActions.update,
    clearAllSteps: stepActions.clearAll,
    
    // UI
    setChangePatternMode: uiActions.setChangePatternMode,
    setPasteActive: uiActions.setPasteActive,
    setTransposeMode: uiActions.setTransposeMode,
    setTransposeValue: uiActions.setTransposeValue,
    
    // MIDI
    selectInputDevice: midi.selectInputDevice,
    toggleMidiLearn: midi.toggleMidiLearn,
    saveMidiAssignments: midi.saveMidiAssignments,
    refreshMidiDevices: midi.refreshDevices,
    
    // Persistence
    saveState: persistence.save,
    loadState: persistence.load,
    clearState: persistence.clear,
    exportState: persistence.exportState,
    importState: persistence.importState,
  }), [
    playback,
    patternActions,
    trackActions,
    stepActions,
    uiActions,
    midi,
    persistence,
  ]);

  return {
    sequencerState,
    currentPattern,
    currentTrack,
    actions,
    
    // Direct store access for advanced use cases
    store,
    
    // Individual hook returns for granular access
    playback,
    midi,
    persistence,
  };
}

export default useSequencer;
