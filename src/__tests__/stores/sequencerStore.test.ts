import { describe, it, expect, beforeEach } from 'vitest';
import { useSequencerStore, createInitialStep, createInitialTrack, createInitialPattern } from '@/stores/sequencerStore';

describe('sequencerStore', () => {
  beforeEach(() => {
    useSequencerStore.getState().resetState();
  });

  describe('initial state', () => {
    it('should have default BPM', () => {
      expect(useSequencerStore.getState().bpm).toBe(120);
    });

    it('should have default swing', () => {
      expect(useSequencerStore.getState().swing).toBe(0);
    });

    it('should not be playing', () => {
      expect(useSequencerStore.getState().isPlaying).toBe(false);
    });

    it('should have one initial pattern', () => {
      const patterns = useSequencerStore.getState().patterns;
      expect(Object.keys(patterns)).toHaveLength(1);
      expect(patterns['pattern0']).toBeDefined();
    });

    it('should have one initial track', () => {
      const pattern = useSequencerStore.getState().patterns['pattern0'];
      expect(Object.keys(pattern.tracks)).toHaveLength(1);
      expect(pattern.tracks['track0']).toBeDefined();
    });
  });

  describe('pattern actions', () => {
    it('should add a new pattern', () => {
      const newPattern = useSequencerStore.getState().addPattern();
      
      expect(newPattern.patternNumber).toBe(1);
      expect(useSequencerStore.getState().patterns['pattern1']).toBeDefined();
    });

    it('should delete a pattern', () => {
      useSequencerStore.getState().addPattern();
      const result = useSequencerStore.getState().deletePattern('pattern1');
      
      expect(result).toBe(true);
      expect(useSequencerStore.getState().patterns['pattern1']).toBeUndefined();
    });

    it('should not delete the last pattern', () => {
      const result = useSequencerStore.getState().deletePattern('pattern0');
      
      expect(result).toBe(false);
      expect(useSequencerStore.getState().patterns['pattern0']).toBeDefined();
    });

    it('should select a pattern', () => {
      useSequencerStore.getState().addPattern();
      useSequencerStore.getState().selectPattern('pattern1');
      
      expect(useSequencerStore.getState().currentPatternId).toBe('pattern1');
    });

    it('should copy a pattern', () => {
      const original = useSequencerStore.getState().patterns['pattern0'];
      original.name = 'Test Pattern';
      
      const copy = useSequencerStore.getState().copyPattern('pattern0');
      
      expect(copy).not.toBeNull();
      expect(copy?.name).toBe('Pattern 2');
      expect(copy?.patternNumber).toBe(1);
    });

    it('should queue a pattern', () => {
      useSequencerStore.getState().addPattern();
      useSequencerStore.getState().queuePattern('pattern1');
      
      expect(useSequencerStore.getState().nextPatternQueue).toContain('pattern1');
    });
  });

  describe('track actions', () => {
    it('should add a new track', () => {
      const newTrack = useSequencerStore.getState().addTrack();
      
      expect(newTrack.trackNumber).toBe(1);
      expect(useSequencerStore.getState().patterns['pattern0'].tracks['track1']).toBeDefined();
    });

    it('should delete a track', () => {
      useSequencerStore.getState().addTrack();
      const result = useSequencerStore.getState().deleteTrack('track1');
      
      expect(result).toBe(true);
      expect(useSequencerStore.getState().patterns['pattern0'].tracks['track1']).toBeUndefined();
    });

    it('should not delete the last track', () => {
      const result = useSequencerStore.getState().deleteTrack('track0');
      
      expect(result).toBe(false);
    });

    it('should toggle track mute', () => {
      useSequencerStore.getState().toggleTrackMute('track0');
      
      expect(useSequencerStore.getState().patterns['pattern0'].tracks['track0'].muted).toBe(true);
    });

    it('should clear a track', () => {
      // Enable a step first
      useSequencerStore.getState().toggleStep('b01');
      expect(useSequencerStore.getState().patterns['pattern0'].tracks['track0'].steps[0].enabled).toBe(true);
      
      useSequencerStore.getState().clearTrack('track0');
      
      expect(useSequencerStore.getState().patterns['pattern0'].tracks['track0'].steps[0].enabled).toBe(false);
    });
  });

  describe('step actions', () => {
    it('should toggle a step on', () => {
      useSequencerStore.getState().toggleStep('b01');
      
      const step = useSequencerStore.getState().patterns['pattern0'].tracks['track0'].steps[0];
      expect(step.enabled).toBe(true);
      expect(step.notePitch).toBe(60); // default
    });

    it('should toggle a step off', () => {
      useSequencerStore.getState().toggleStep('b01');
      useSequencerStore.getState().toggleStep('b01');
      
      const step = useSequencerStore.getState().patterns['pattern0'].tracks['track0'].steps[0];
      expect(step.enabled).toBe(false);
    });

    it('should force clear a step', () => {
      useSequencerStore.getState().toggleStep('b01');
      useSequencerStore.getState().toggleStep('b01', true);
      
      const step = useSequencerStore.getState().patterns['pattern0'].tracks['track0'].steps[0];
      expect(step.enabled).toBe(false);
    });

    it('should select a step', () => {
      useSequencerStore.getState().selectStep('b01');
      
      expect(useSequencerStore.getState().selectedStepId).toBe('b01');
    });

    it('should update step parameters', () => {
      useSequencerStore.getState().updateStep('b01', { notePitch: 64, velocity: 100 });
      
      const step = useSequencerStore.getState().patterns['pattern0'].tracks['track0'].steps[0];
      expect(step.notePitch).toBe(64);
      expect(step.velocity).toBe(100);
    });
  });

  describe('playback actions', () => {
    it('should start playback', () => {
      useSequencerStore.getState().play();
      
      expect(useSequencerStore.getState().isPlaying).toBe(true);
      expect(useSequencerStore.getState().activeStepIndex).toBe(-1);
    });

    it('should stop playback', () => {
      useSequencerStore.getState().play();
      useSequencerStore.getState().stop();
      
      expect(useSequencerStore.getState().isPlaying).toBe(false);
      expect(useSequencerStore.getState().activeStepIndex).toBeNull();
    });

    it('should set BPM', () => {
      useSequencerStore.getState().setBpm(140);
      
      expect(useSequencerStore.getState().bpm).toBe(140);
    });

    it('should not set invalid BPM', () => {
      useSequencerStore.getState().setBpm(0);
      useSequencerStore.getState().setBpm(1000);
      
      expect(useSequencerStore.getState().bpm).toBe(120); // unchanged
    });

    it('should set swing', () => {
      useSequencerStore.getState().setSwing(50);
      
      expect(useSequencerStore.getState().swing).toBe(50);
    });

    it('should not set invalid swing', () => {
      useSequencerStore.getState().setSwing(-1);
      useSequencerStore.getState().setSwing(76);
      
      expect(useSequencerStore.getState().swing).toBe(0); // unchanged
    });

    it('should advance step', () => {
      useSequencerStore.getState().play();
      useSequencerStore.getState().setActiveStep(0);
      useSequencerStore.getState().advanceStep();
      
      expect(useSequencerStore.getState().activeStepIndex).toBe(1);
    });
  });

  describe('MIDI actions', () => {
    it('should toggle MIDI learn mode', () => {
      useSequencerStore.getState().toggleMidiLearn();
      
      expect(useSequencerStore.getState().midiLearnActive).toBe(true);
    });

    it('should save MIDI assignments', () => {
      const assignments = {
        setup_play: 1,
        setup_stop: 2,
        setup_step1: 10,
        setup_track1: 20,
      };
      
      useSequencerStore.getState().saveMidiAssignments(assignments);
      
      expect(useSequencerStore.getState().midiAssignments['setup_play']).toBe(1);
      expect(useSequencerStore.getState().ledOrder).toContain(10);
      expect(useSequencerStore.getState().trackSelectors).toContain(20);
    });
  });

  describe('persistence', () => {
    it('should load state', () => {
      const newState = {
        bpm: 140,
        swing: 25,
        patterns: {
          pattern0: createInitialPattern(0),
        },
        currentPatternId: 'pattern0',
        currentTrackId: 'track0',
      };
      
      useSequencerStore.getState().loadState(newState);
      
      expect(useSequencerStore.getState().bpm).toBe(140);
      expect(useSequencerStore.getState().swing).toBe(25);
    });

    it('should reset state', () => {
      useSequencerStore.getState().setBpm(140);
      useSequencerStore.getState().resetState();
      
      expect(useSequencerStore.getState().bpm).toBe(120);
    });
  });
});

describe('helper functions', () => {
  describe('createInitialStep', () => {
    it('should create step with correct ID', () => {
      const step = createInitialStep(0);
      expect(step.id).toBe('b01');
      expect(step.enabled).toBe(false);
    });

    it('should pad step numbers correctly', () => {
      expect(createInitialStep(0).id).toBe('b01');
      expect(createInitialStep(9).id).toBe('b10');
      expect(createInitialStep(15).id).toBe('b16');
    });
  });

  describe('createInitialTrack', () => {
    it('should create track with correct properties', () => {
      const track = createInitialTrack(0);
      
      expect(track.id).toBe('track0');
      expect(track.trackNumber).toBe(0);
      expect(track.name).toBe('Track 1');
      expect(track.steps).toHaveLength(16);
      expect(track.muted).toBe(false);
    });

    it('should create tracks with sequential channel numbers', () => {
      const track0 = createInitialTrack(0);
      const track1 = createInitialTrack(1);
      
      expect(track0.midiChannel).toBe('0000');
      expect(track1.midiChannel).toBe('0001');
    });
  });

  describe('createInitialPattern', () => {
    it('should create pattern with correct properties', () => {
      const pattern = createInitialPattern(0);
      
      expect(pattern.id).toBe('pattern0');
      expect(pattern.patternNumber).toBe(0);
      expect(pattern.name).toBe('Pattern 1');
      expect(Object.keys(pattern.tracks)).toHaveLength(1);
    });
  });
});
