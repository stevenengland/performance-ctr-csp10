import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'deploy',
          environment: 'node',
          include: ['deploy/**/*.test.ts', 'scripts/**/*.test.ts'],
          // The container proof of the deploy adapter runs via `npm run test:deploy`.
          exclude: ['deploy/**/*.integration.test.ts'],
        },
      },
      'web/vite.config.ts',
    ],
  },
});
