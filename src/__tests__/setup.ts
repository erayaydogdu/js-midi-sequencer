import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Web MIDI API
global.navigator.requestMIDIAccess = vi.fn();

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock as unknown as Storage;

// Mock Worker
global.Worker = vi.fn().mockImplementation(() => ({
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null,
  onerror: null,
}));

// Mock performance.now
global.performance.now = vi.fn(() => Date.now());
