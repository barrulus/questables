/* eslint-env node */

import '@testing-library/jest-dom';
import { afterEach, jest } from '@jest/globals';

const win = typeof globalThis.window !== 'undefined' ? globalThis.window : undefined;

if (win && typeof win.matchMedia !== 'function') {
  Object.defineProperty(win, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

const sessionStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

if (win) {
  Object.defineProperty(win, 'localStorage', {
    writable: true,
    value: localStorageMock,
  });

  Object.defineProperty(win, 'sessionStorage', {
    writable: true,
    value: sessionStorageMock,
  });
}

// Mock ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  constructor(cb) {
    this.cb = cb;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor(cb) {
    this.cb = cb;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock scrollTo
globalThis.scrollTo = jest.fn();

// Mock environment variables
if (globalThis.process?.env) {
  globalThis.process.env.NODE_ENV = 'test';
  globalThis.process.env.VITE_DATABASE_URL = 'http://localhost:3001';
}

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
  sessionStorageMock.clear();
});
