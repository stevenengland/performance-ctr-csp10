import { defineConfig, devices, type Project } from '@playwright/test';

/** The containerised stack (e2e/stack) serving the built artifact. */
const stackUrl = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const previewPort = 4173;
/** PW_CHANNEL=chrome drives an installed Chrome instead of Playwright's Chromium. */
const channel = process.env.PW_CHANNEL;

const windows = {
  compact: { width: 390, height: 844 },
  expanded: { width: 1280, height: 800 },
} as const;

function project(
  name: string,
  window: keyof typeof windows,
  baseURL: string,
  match: Pick<Project, 'testMatch' | 'testIgnore'>,
): Project {
  return {
    name: `${name}-${window}`,
    ...match,
    use: {
      ...devices['Desktop Chrome'],
      channel,
      viewport: windows[window],
      isMobile: window === 'compact',
      hasTouch: window === 'compact',
      baseURL,
    },
  };
}

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', locale: 'de-DE' },
  projects: [
    project('stack', 'compact', stackUrl, { testIgnore: 'preview.spec.ts' }),
    project('stack', 'expanded', stackUrl, { testIgnore: 'preview.spec.ts' }),
    project('preview', 'compact', `http://127.0.0.1:${previewPort}`, {
      testMatch: 'preview.spec.ts',
    }),
    project('preview', 'expanded', `http://127.0.0.1:${previewPort}`, {
      testMatch: 'preview.spec.ts',
    }),
  ],
  webServer: {
    command: `node e2e/support/serve-static.ts web/dist-preview ${previewPort}`,
    url: `http://127.0.0.1:${previewPort}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
