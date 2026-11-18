import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuditPage } from '../../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import {
  buttonIn,
  click,
  json,
  mountPage,
  problem,
} from '../manage-page-harness';
import ProtokollPage from './ProtokollPage.vue';

function event(
  id: number,
  occurredAt: string,
  change: Partial<AuditEvent>,
): AuditEvent {
  return {
    id,
    occurredAt,
    operation: 'create',
    subjectKind: 'drink',
    subjectId: String(id),
    actor: { accountId: 1, userName: 'anna' },
    before: null,
    after: null,
    cause: null,
    ...change,
  };
}

const wine = { person: 'Daniel', drink: 'Wein', points: 1.5, quantity: 1 };

/** The newest page: today an entry the deletion of Wein removed, and a change of Bier's points. */
const newest: AuditPage = {
  events: [
    event(12, '2026-11-15T22:41:00.000Z', {
      operation: 'delete',
      subjectKind: 'entry',
      subjectId: '6f1c0e1e-0000-4000-8000-000000000001',
      before: { ...wine, factor: null },
      cause: { id: 10, subjectKind: 'drink', name: 'Wein' },
    }),
    event(11, '2026-11-15T21:58:00.000Z', {
      operation: 'update',
      actor: { accountId: 2, userName: 'ben' },
      before: { name: 'Bier', points: 1 },
      after: { name: 'Bier', points: 0.5 },
    }),
  ],
  next: 11,
};

/** The older page: the deletion of Wein, also today, and Daniel's creation yesterday. */
const older: AuditPage = {
  events: [
    event(10, '2026-11-15T21:57:00.000Z', {
      operation: 'delete',
      before: { name: 'Wein', points: 1.5 },
    }),
    event(3, '2026-11-14T19:00:00.000Z', {
      subjectKind: 'person',
      after: { name: 'Daniel' },
    }),
  ],
  next: null,
};

/** A fake audit route over the given pages, keyed by `before` ('' for the newest). */
function api(pages: Record<string, () => Response | Promise<Response>>) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      const before =
        new URL(url, 'http://app').searchParams.get('before') ?? '';
      const page = pages[before];
      if (!url.startsWith('/api/audit') || !page) {
        throw new Error(`unexpected ${url}`);
      }
      return page();
    }),
  );
  return asked;
}

const days = (wrapper: VueWrapper) =>
  wrapper
    .findAll('section > section')
    .map((day) => [
      day.get('h2').text(),
      day.findAll('[data-test="audit-event"]').map((row) => row.text()),
    ]);

const more = (wrapper: VueWrapper) =>
  wrapper
    .findAll('button')
    .filter((button) => button.text() === 'Ältere laden');

describe('Protokoll', () => {
  const zone = process.env.TZ;
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({
      now: new Date('2026-11-15T22:45:00Z'),
      toFake: ['Date'],
    });
    dismissSnackbar();
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env.TZ = zone;
  });

  it('shows the newest events under their day with subject, changed values, day and time, user name and operation, and a consequential one with its cause from another page', async () => {
    api({ '': () => json(newest) });

    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    expect(days(wrapper)).toEqual([
      [
        'Heute',
        [
          'Eintrag 1× Wein für Daniel1,5 Punkte15.11., 23:41 · anna · durch Löschen von WeinGelöscht',
          'Getränk BierPunkte: 1 Punkt → 0,5 Punkte15.11., 22:58 · benGeändert',
        ],
      ],
    ]);
    const [caused, direct] = wrapper.findAll('[data-test="audit-event"]');
    expect(caused?.classes()).toContain('protokoll__row--caused');
    expect(direct?.classes()).not.toContain('protokoll__row--caused');
    expect(wrapper.text()).toContain(
      'Das Protokoll kann nicht bearbeitet oder gelöscht werden.',
    );
  });

  it('loads the next older page below the loaded ones and has no button on the last page', async () => {
    const asked = api({ '': () => json(newest), '11': () => json(older) });
    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    const [button] = more(wrapper);
    if (!button) throw new Error('no Ältere laden');
    await click(button.element as HTMLButtonElement);

    expect(asked).toEqual(['/api/audit', '/api/audit?before=11']);
    expect(days(wrapper)).toEqual([
      [
        'Heute',
        [
          'Eintrag 1× Wein für Daniel1,5 Punkte15.11., 23:41 · anna · durch Löschen von WeinGelöscht',
          'Getränk BierPunkte: 1 Punkt → 0,5 Punkte15.11., 22:58 · benGeändert',
          'Getränk Wein1,5 Punkte15.11., 22:57 · annaGelöscht',
        ],
      ],
      ['Gestern', ['Person Daniel14.11., 20:00 · annaAngelegt']],
    ]);
    expect(more(wrapper)).toHaveLength(0);
  });

  it('moves the day headings on when the page is used again on a later day', async () => {
    api({ '': () => json(newest) });
    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    vi.setSystemTime(new Date('2026-11-16T00:05:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(days(wrapper).map(([label]) => label)).toEqual(['Gestern']);
  });

  it('keeps the loaded events and the button when an older page fails', async () => {
    api({
      '': () => json(newest),
      '11': () => problem(503, { title: 'Wartung.' }),
    });
    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    await click(buttonIn(document, 'Ältere laden'));

    expect(useSnackbar().value?.text).toBe('Wartung.');
    expect(wrapper.findAll('[data-test="audit-event"]')).toHaveLength(2);
    expect(more(wrapper)).toHaveLength(1);
  });

  it('shows four skeleton rows, and neither the empty text nor the button, until the first page arrives', async () => {
    let answer: (response: Response) => void = () => undefined;
    api({
      '': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });

    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    const busy = wrapper.get('[aria-busy="true"]');
    expect(busy.findAll('.skeleton')).toHaveLength(4);
    expect(wrapper.text()).not.toContain('Noch keine Änderungen.');
    expect(more(wrapper)).toHaveLength(0);

    answer(json(newest));
    await flushPromises();

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="audit-event"]')).toHaveLength(2);
  });

  it('says the log was not loaded and offers a retry when the first page fails, and shows it once the retry succeeds', async () => {
    let failing = true;
    const asked = api({
      '': () => {
        if (failing) throw new TypeError('Failed to fetch');
        return json(newest);
      },
    });

    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Protokoll nicht geladen.');
    expect(wrapper.text()).not.toContain('Noch keine Änderungen.');

    failing = false;
    await click(buttonIn(document, 'Erneut versuchen'));

    expect(asked).toEqual(['/api/audit', '/api/audit']);
    expect(wrapper.text()).not.toContain('Protokoll nicht geladen.');
    expect(wrapper.findAll('[data-test="audit-event"]')).toHaveLength(2);
    expect(more(wrapper)).toHaveLength(1);
  });

  it('shows the problem title too when the first page is refused', async () => {
    api({ '': () => problem(503, { title: 'Wartung.' }) });

    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    expect(useSnackbar().value?.text).toBe('Wartung.');
    expect(wrapper.text()).toContain('Protokoll nicht geladen.');
    expect(buttonIn(document, 'Erneut versuchen')).toBeDefined();
  });

  it('says so when the log is empty', async () => {
    api({ '': () => json({ events: [], next: null }) });

    wrapper = await mountPage('/verwalten/protokoll', ProtokollPage);

    expect(wrapper.text()).toContain('Noch keine Änderungen.');
    expect(wrapper.findAll('[data-test="audit-event"]')).toHaveLength(0);
    expect(more(wrapper)).toHaveLength(0);
  });
});
