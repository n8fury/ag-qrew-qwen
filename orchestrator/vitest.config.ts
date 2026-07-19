import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // AGQREW_MOCK=1 must be set BEFORE any test file imports config.ts (which
    // otherwise demands a real DASHSCOPE_API_KEY at import time) — setupFiles
    // load ahead of each test module, so the whole suite runs key-less.
    setupFiles: ['src/__tests__/setup.ts'],
    testTimeout: 30_000,
  },
});
