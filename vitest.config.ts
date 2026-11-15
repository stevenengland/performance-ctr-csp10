import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'deploy',
          environment: 'node',
          include: ['deploy/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      'web/vite.config.ts',
    ],
  },
});
