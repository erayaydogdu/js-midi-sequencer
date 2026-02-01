/**
 * MIDI Service - Abstraction layer for Web MIDI API
 * 
 * Provides a clean interface for MIDI operations including:
 * - Device enumeration and selection
 * - Message sending/receiving
 * - LED feedback control
 * - Error handling with Result types
 */

import type { MIDIDevice, MIDIMessageEvent } from '@/types/sequencer';

// ============================================================================
// Error Types
// ============================================================================

export class MIDIError extends Error {
  constructor(
    message: string,
    public code: 'DEVICE_NOT_FOUND' | 'ACCESS_DENIED' | 'SEND_FAILED' | 'NOT_SUPPORTED'
  ) {
    super(message);
    this.name = 'MIDIError';
  }
}

export type Result<T, E = MIDIError> = 
  | { success: true; data: T }
  | { success: false; error: E };

export const ok = <T>(data: T): Result<T, never> => ({ success: true, data });
export const err = <E>(error: E): Result<never, E> => ({ success: false, error });

// ============================================================================
// Interfaces
// ============================================================================

export interface MIDIService {
  // Initialization
  initialize(): Promise<Result<void>>;
  
  // Device Management
  getInputs(): MIDIDevice[];
  getOutputs(): MIDIDevice[];
  getInputById(id: string): MIDIInput | undefined;
  getOutputById(id: string): MIDIOutput | undefined;
  
  // Message Handling
  sendMessage(deviceId: string, data: number[] | Uint8Array): Result<void>;
  onMessage(callback: (event: MIDIMessageEvent) => void): () => void;
  
  // LED Control
  updateStepLEDs(deviceId: string, ledOrder: number[], activeStep: number): Result<void>;
  clearAllLEDs(deviceId: string, ledOrder: number[]): Result<void>;
  updateControlLEDs(
    deviceId: string, 
    config: {
      trackSelectors: number[];
      patternCC?: number;
      currentTrackIndex: number;
      currentPatternIndex: number;
      isPatternMode: boolean;
    }
  ): Result<void>;
  
  // State
  isInitialized(): boolean;
  getAccess(): MIDIAccess | null;
}

// ============================================================================
// Implementation
// ============================================================================

class MIDIServiceImpl implements MIDIService {
  private access: MIDIAccess | null = null;
  private messageCallbacks: Set<(event: MIDIMessageEvent) => void> = new Set();
  private boundMessageHandler: ((event: MIDIMessageEvent) => void) | null = null;

  async initialize(): Promise<Result<void>> {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      return err(new MIDIError('Web MIDI API not supported', 'NOT_SUPPORTED'));
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      
      // Listen for device state changes
      this.access.addEventListener('statechange', () => {
        this.reattachListeners();
      });
      
      // Attach listeners to existing inputs
      this.reattachListeners();
      
      return ok(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new MIDIError(`Failed to get MIDI access: ${message}`, 'ACCESS_DENIED'));
    }
  }

  private reattachListeners(): void {
    if (!this.access) return;

    // Remove existing listeners
    this.access.inputs.forEach(input => {
      input.removeEventListener('midimessage', this.handleMIDIMessage as EventListener);
    });

    // Attach new listeners
    this.access.inputs.forEach(input => {
      input.addEventListener('midimessage', this.handleMIDIMessage as EventListener);
    });
  }

  private handleMIDIMessage = (event: Event): void => {
    const midiEvent = event as unknown as MIDIMessageEvent & { target: MIDIInput };
    
    const simplifiedEvent: MIDIMessageEvent = {
      data: midiEvent.data,
      receivedTime: midiEvent.receivedTime,
      srcElement: { id: midiEvent.target?.id || 'unknown' },
    };

    this.messageCallbacks.forEach(callback => {
      try {
        callback(simplifiedEvent);
      } catch (error) {
        console.error('Error in MIDI message callback:', error);
      }
    });
  };

  getInputs(): MIDIDevice[] {
    if (!this.access) return [];
    
    const inputs: MIDIDevice[] = [];
    this.access.inputs.forEach(input => {
      inputs.push({
        id: input.id,
        name: input.name || `Input ${input.id}`,
        type: 'input',
      });
    });
    return inputs;
  }

  getOutputs(): MIDIDevice[] {
    if (!this.access) return [];
    
    const outputs: MIDIDevice[] = [];
    this.access.outputs.forEach(output => {
      outputs.push({
        id: output.id,
        name: output.name || `Output ${output.id}`,
        type: 'output',
      });
    });
    return outputs;
  }

  getInputById(id: string): MIDIInput | undefined {
    if (!this.access) return undefined;
    return this.access.inputs.get(id);
  }

  getOutputById(id: string): MIDIOutput | undefined {
    if (!this.access) return undefined;
    return this.access.outputs.get(id);
  }

  sendMessage(deviceId: string, data: number[] | Uint8Array): Result<void> {
    const output = this.getOutputById(deviceId);
    if (!output) {
      return err(new MIDIError(`Output device ${deviceId} not found`, 'DEVICE_NOT_FOUND'));
    }

    try {
      output.send(data);
      return ok(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new MIDIError(`Failed to send MIDI message: ${message}`, 'SEND_FAILED'));
    }
  }

  onMessage(callback: (event: MIDIMessageEvent) => void): () => void {
    this.messageCallbacks.add(callback);
    
    return () => {
      this.messageCallbacks.delete(callback);
    };
  }

  updateStepLEDs(deviceId: string, ledOrder: number[], activeStep: number): Result<void> {
    if (!deviceId || ledOrder.length === 0) {
      return ok(undefined); // Nothing to do
    }

    // Turn off all LEDs first
    for (let i = 0; i < ledOrder.length; i++) {
      const ledCC = ledOrder[i];
      if (ledCC !== undefined) {
        const result = this.sendMessage(deviceId, [0xB0, ledCC, 0]);
        if (!result.success) return result;
      }
    }

    // Turn on active LED
    if (activeStep >= 0 && activeStep < ledOrder.length) {
      const activeLedCC = ledOrder[activeStep];
      if (activeLedCC !== undefined) {
        const result = this.sendMessage(deviceId, [0xB0, activeLedCC, 127]);
        if (!result.success) return result;
      }
    }

    return ok(undefined);
  }

  clearAllLEDs(deviceId: string, ledOrder: number[]): Result<void> {
    if (!deviceId) return ok(undefined);

    for (const ledCC of ledOrder) {
      if (ledCC !== undefined) {
        const result = this.sendMessage(deviceId, [0xB0, ledCC, 0]);
        if (!result.success) return result;
      }
    }

    return ok(undefined);
  }

  updateControlLEDs(
    deviceId: string,
    config: {
      trackSelectors: number[];
      patternCC?: number;
      currentTrackIndex: number;
      currentPatternIndex: number;
      isPatternMode: boolean;
    }
  ): Result<void> {
    if (!deviceId) return ok(undefined);

    // Turn off all track/pattern selector LEDs
    for (const cc of config.trackSelectors) {
      const result = this.sendMessage(deviceId, [0xB0, cc, 0]);
      if (!result.success) return result;
    }

    // Turn off pattern mode LED
    if (config.patternCC !== undefined) {
      const result = this.sendMessage(deviceId, [0xB0, config.patternCC, 0]);
      if (!result.success) return result;
    }

    // Turn on appropriate LED based on mode
    if (config.isPatternMode) {
      // Pattern mode: light up pattern mode toggle and current pattern
      if (config.patternCC !== undefined) {
        const result = this.sendMessage(deviceId, [0xB0, config.patternCC, 127]);
        if (!result.success) return result;
      }

      if (config.currentPatternIndex >= 0 && config.currentPatternIndex < config.trackSelectors.length) {
        const patternLedCC = config.trackSelectors[config.currentPatternIndex];
        const result = this.sendMessage(deviceId, [0xB0, patternLedCC, 127]);
        if (!result.success) return result;
      }
    } else {
      // Track mode: light up current track
      if (config.currentTrackIndex >= 0 && config.currentTrackIndex < config.trackSelectors.length) {
        const trackLedCC = config.trackSelectors[config.currentTrackIndex];
        const result = this.sendMessage(deviceId, [0xB0, trackLedCC, 127]);
        if (!result.success) return result;
      }
    }

    return ok(undefined);
  }

  isInitialized(): boolean {
    return this.access !== null;
  }

  getAccess(): MIDIAccess | null {
    return this.access;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const midiService: MIDIService = new MIDIServiceImpl();
export default midiService;
