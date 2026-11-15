import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireReload, resetReloadFloor } from '../pwa/reload-floor';
import { stubDialogEnvironment } from '../features/verwalten/manage-page-harness';
import { createAppVuetify } from '../theme';
import ReloadFloorDialog from './ReloadFloorDialog.vue';

const activateLatestAndReload = vi.hoisted(() =>
  vi.fn(() => Promise.resolve()),
);
vi.mock('../pwa/update-prompt', () => ({ activateLatestAndReload }));

describe('ReloadFloorDialog', () => {
  afterEach(() => {
    resetReloadFloor();
    document.body.innerHTML = '';
  });

  it('"Neu laden" activates the newest service worker before it reloads', async () => {
    stubDialogEnvironment();
    requireReload();
    mount(ReloadFloorDialog, {
      global: { plugins: [createAppVuetify()] },
      attachTo: document.body,
    });
    await flushPromises();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Bitte neu laden');
    const button = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent.trim() === 'Neu laden',
    );
    button?.click();
    await flushPromises();

    expect(activateLatestAndReload).toHaveBeenCalledOnce();
  });
});
