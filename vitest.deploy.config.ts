import { defineConfig } from 'vitest/config';

// Container proof of the deploy adapter (imported from projekt2406): real
// OpenSSH sftp and Apache, one sftp session per observation wave and phase.
export default defineConfig({
  test: {
    include: ['deploy/**/*.integration.test.ts'],
    hookTimeout: 300_000,
    testTimeout: 600_000,
  },
});
