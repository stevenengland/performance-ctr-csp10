import { vi } from 'vitest';

/*
jsdom lacks the browser APIs Vuetify probes when its modules load; the media
query answers "light" unless a test overrides the implementation.
*/
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

/*
A class, not an arrow `vi.fn`: Vuetify calls `new ResizeObserver(…)` (a busy
`v-btn` measures its progress indicator), and an arrow function is no constructor.
*/
globalThis.ResizeObserver ??= class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};
