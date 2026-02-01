/**
 * Playback Service - Manages sequencer playback timing and note scheduling
 * 
 * Uses a Web Worker for accurate timing and handles:
 * - Step sequencing
 * - Note on/off scheduling
 * - Pattern transitions
 * - LED feedback synchronization
 */

import type { Pattern, Track, Step } from '@/types/sequencer';
import { midiService } from './midiService';

// Result type for playback service
type Result<T, E = PlaybackError> = 
  | { success: true; data: T }
  | { success: false; error: E };

const ok = <T>(data: T): Result<T, never> => ({ success: true, data });
const err = <E>(error: E): Result<never, E> => ({ success: false, error });

// ============================================================================
// Error Types
// ============================================================================

export class PlaybackError extends Error {
  constructor(
    message: string,
    public code: 'WORKER_ERROR' | 'NOT_INITIALIZED' | 'ALREADY_PLAYING' | 'NOT_PLAYING'
  ) {
    super(message);
    this.name = 'PlaybackError';
  }
}

// ============================================================================
// Types
// ============================================================================

export interface PlaybackState {
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  swing: number;
}

export interface NoteEvent {
  type: 'on' | 'off';
  trackId: string;
  deviceId: string;
  channel: number;
  pitch: number;
  velocity: number;
}

export interface PlaybackCallbacks {
  onStep: (step: number) => void;
  onPatternChange: (patternId: string) => void;
  onError: (error: PlaybackError) => void;
}

// ============================================================================
// Constants
// ============================================================================

const STEPS_PER_PATTERN = 16;
const DEFAULT_VELOCITY = 100;

// ============================================================================
// Service Implementation
// ============================================================================

class PlaybackService {
  private worker: Worker | null = null;
  private state: PlaybackState = {
    isPlaying: false,
    currentStep: -1,
    bpm: 120,
    swing: 0,
  };
  private callbacks: PlaybackCallbacks | null = null;
  private activeNotes: Map<string, Map<number, number>> = new Map(); // trackId -> note -> stepIndex
  private currentPattern: Pattern | null = null;
  private nextPatternId: string | null = null;

  // Track output cache
  private outputCache: Map<string, MIDIOutput | undefined> = new Map();

  async initialize(): Promise<Result<void>> {
    if (this.worker) {
      return ok(undefined); // Already initialized
    }

    try {
      this.worker = new Worker(new URL('../workers/timerWorker.ts', import.meta.url));
      
      this.worker.onmessage = (e: MessageEvent) => {
        this.handleWorkerMessage(e);
      };

      this.worker.onerror = (error) => {
        console.error('Playback worker error:', error);
        this.callbacks?.onError(new PlaybackError('Worker error', 'WORKER_ERROR'));
      };

      return ok(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PlaybackError(`Failed to initialize worker: ${message}`, 'WORKER_ERROR'));
    }
  }

  private handleWorkerMessage(e: MessageEvent): void {
    if (e.data.type === 'tick') {
      const step = e.data.step as number;
      this.processStep(step);
    }
  }

  private processStep(step: number): void {
    if (!this.currentPattern || !this.callbacks) return;

    this.state.currentStep = step;

    // Check for pattern transition at step 0
    if (step === 0 && this.nextPatternId) {
      this.allNotesOff(true);
      this.currentPattern = null; // Will be set by callback
      this.callbacks.onPatternChange(this.nextPatternId);
      this.nextPatternId = null;
      return;
    }

    // Process each track
    Object.values(this.currentPattern.tracks).forEach(track => {
      this.processTrackStep(track, step);
    });

    // Notify callback
    this.callbacks.onStep(step);
  }

  private processTrackStep(track: Track, step: number): void {
    if (track.muted) return;
    if (!track.outputDeviceId) return;

    const output = this.getTrackOutput(track);
    if (!output) return;

    const channel = parseInt(track.midiChannel, 16);
    if (isNaN(channel) || channel < 0 || channel > 15) return;

    const noteOnCmd = 0x90 | channel;
    const noteOffCmd = 0x80 | channel;
    const transpose = track.transpose || 0;

    // Initialize active notes for this track
    if (!this.activeNotes.has(track.id)) {
      this.activeNotes.set(track.id, new Map());
    }
    const trackActiveNotes = this.activeNotes.get(track.id)!;

    // Handle note offs
    this.handleNoteOffs(track, step, trackActiveNotes, noteOffCmd, track.outputDeviceId);

    // Handle note ons
    const stepData = track.steps[step];
    if (stepData?.enabled && stepData.notePitch !== undefined) {
      const pitch = stepData.notePitch + transpose;
      const velocity = stepData.velocity ?? DEFAULT_VELOCITY;

      if (pitch >= 0 && pitch <= 127) {
        // Retrigger if already playing
        if (trackActiveNotes.has(pitch)) {
          midiService.sendMessage(track.outputDeviceId, [noteOffCmd, pitch, 0]);
          trackActiveNotes.delete(pitch);
        }

        midiService.sendMessage(track.outputDeviceId, [noteOnCmd, pitch, velocity]);
        trackActiveNotes.set(pitch, step);
      }
    }
  }

  private handleNoteOffs(
    track: Track, 
    currentStep: number, 
    activeNotes: Map<number, number>,
    noteOffCmd: number,
    deviceId: string
  ): void {
    const notesToRemove: number[] = [];

    activeNotes.forEach((startStep, pitch) => {
      const stepDef = track.steps[startStep];
      if (!stepDef || stepDef.notePitch === undefined) {
        // Note definition missing, turn off
        midiService.sendMessage(deviceId, [noteOffCmd, pitch, 0]);
        notesToRemove.push(pitch);
        return;
      }

      const noteLength = stepDef.noteLength ?? 1;
      const endStep = (startStep + noteLength) % STEPS_PER_PATTERN;

      if (endStep === currentStep) {
        midiService.sendMessage(deviceId, [noteOffCmd, pitch, 0]);
        notesToRemove.push(pitch);
      }
    });

    notesToRemove.forEach(pitch => activeNotes.delete(pitch));
  }

  private getTrackOutput(track: Track): MIDIOutput | undefined {
    if (!track.outputDeviceId) return undefined;

    let output = this.outputCache.get(track.id);
    if (output === undefined) {
      output = midiService.getOutputById(track.outputDeviceId);
      this.outputCache.set(track.id, output);
    }
    return output;
  }

  start(pattern: Pattern, callbacks: PlaybackCallbacks): Result<void> {
    if (!this.worker) {
      return err(new PlaybackError('Service not initialized', 'NOT_INITIALIZED'));
    }
    if (this.state.isPlaying) {
      return err(new PlaybackError('Already playing', 'ALREADY_PLAYING'));
    }

    this.currentPattern = pattern;
    this.callbacks = callbacks;
    this.state.isPlaying = true;
    this.state.currentStep = -1;

    // Pre-cache outputs
    this.outputCache.clear();
    Object.values(pattern.tracks).forEach(track => {
      if (track.outputDeviceId) {
        this.outputCache.set(track.id, midiService.getOutputById(track.outputDeviceId));
      }
    });

    this.worker.postMessage({ cmd: 'start' });
    return ok(undefined);
  }

  stop(): Result<void> {
    if (!this.worker) {
      return err(new PlaybackError('Service not initialized', 'NOT_INITIALIZED'));
    }
    if (!this.state.isPlaying) {
      return err(new PlaybackError('Not playing', 'NOT_PLAYING'));
    }

    this.worker.postMessage({ cmd: 'stop' });
    this.allNotesOff(false);
    
    this.state.isPlaying = false;
    this.state.currentStep = -1;
    this.nextPatternId = null;

    return ok(undefined);
  }

  private allNotesOff(sendImmediately: boolean): void {
    this.activeNotes.forEach((notes, trackId) => {
      const output = this.outputCache.get(trackId);
      if (!output) return;

      const track = this.currentPattern?.tracks[trackId];
      if (!track) return;

      const channel = parseInt(track.midiChannel, 16);
      if (isNaN(channel)) return;

      const noteOffCmd = 0x80 | channel;

      notes.forEach((_, pitch) => {
        midiService.sendMessage(track.outputDeviceId!, [noteOffCmd, pitch, 0]);
      });
    });

    this.activeNotes.clear();
  }

  setBpm(bpm: number): void {
    this.state.bpm = bpm;
    if (this.worker) {
      this.worker.postMessage({ cmd: 'bpm', value: bpm });
    }
  }

  setSwing(swing: number): void {
    this.state.swing = swing;
    if (this.worker) {
      this.worker.postMessage({ cmd: 'swing', value: swing });
    }
  }

  queuePattern(patternId: string): void {
    this.nextPatternId = patternId;
  }

  updatePattern(pattern: Pattern): void {
    this.currentPattern = pattern;
    
    // Update output cache for any new tracks
    Object.values(pattern.tracks).forEach(track => {
      if (track.outputDeviceId && !this.outputCache.has(track.id)) {
        this.outputCache.set(track.id, midiService.getOutputById(track.outputDeviceId));
      }
    });
  }

  isPlaying(): boolean {
    return this.state.isPlaying;
  }

  getCurrentStep(): number {
    return this.state.currentStep;
  }

  dispose(): void {
    if (this.worker) {
      this.stop();
      this.worker.terminate();
      this.worker = null;
    }
    this.callbacks = null;
    this.currentPattern = null;
    this.outputCache.clear();
    this.activeNotes.clear();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const playbackService = new PlaybackService();
export default playbackService;
