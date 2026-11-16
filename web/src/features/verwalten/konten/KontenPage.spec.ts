import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type Router,
} from 'vue-router';
import type { Account } from '../../../core/api-client';
import { forgetSession, resolveSession } from '../../../core/session';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import { createAppVuetify } from '../../../theme';
import {
  buttonIn,
  click,
  dialog,
  json,
  problem,
  rows,
  stubDialogEnvironment,
  type,
  type Call,
} from '../manage-page-harness';
import KontenPage from './KontenPage.vue';

const LAST_ADMIN = {
  type: 'urn:performance:problem:last-admin',
  title: 'Der letzte Admin kann nicht entfernt werden.',
};

/**
A fake accounts API, signed in as account 1: PATCH merges the change, DELETE
removes; a given reply answers the next write instead.
*/
function accountsApi(accounts: Account[], replies: (() => Response)[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : {};
      calls.push({ method, url, body });
      if (url === '/api/session') return json(accounts[0]);
      if (method === 'GET') return json({ accounts: [...accounts] });
      const reply = replies.shift();
      if (reply) return reply();
      const index = accounts.findIndex(
        ({ id }) => id === Number(url.split('/').pop()),
      );
      if (method === 'DELETE') {
        accounts.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      const { isAdmin } = body as { isAdmin?: boolean };
      const changed = {
        ...accounts[index],
        ...(isAdmin === undefined ? {} : { isAdmin }),
      } as Account;
      accounts.splice(index, 1, changed);
      return json(changed);
    }),
  );
  return calls;
}

const anna = (isAdmin = true): Account => ({
  id: 1,
  userName: 'anna',
  isAdmin,
});
const ben = (isAdmin = false): Account => ({ id: 2, userName: 'ben', isAdmin });

let router: Router;

async function page(): Promise<VueWrapper> {
  await resolveSession();
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/verwalten', component: { render: () => h('p', 'Verwalten') } },
      { path: '/verwalten/konten', component: KontenPage },
    ],
  });
  await router.push('/verwalten/konten');
  const wrapper = mount(
    defineComponent(() => () => h(RouterView)),
    {
      global: { plugins: [router, createAppVuetify()] },
      attachTo: document.body,
    },
  );
  await flushPromises();
  return wrapper;
}

/** Opens an account's menu and returns its entries (Vuetify teleports it to the body). */
async function menuOf(userName: string): Promise<HTMLElement[]> {
  await click(buttonIn(document, `Aktionen für ${userName}`));
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

async function choose(userName: string, entry: string) {
  const item = (await menuOf(userName)).find((candidate) =>
    candidate.textContent.includes(entry),
  );
  if (!item) throw new Error(`no menu entry ${entry}`);
  item.click();
  await flushPromises();
}

describe('Verwalten → Konten', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    dismissSnackbar();
    forgetSession();
    stubDialogEnvironment();
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('lists the accounts with the Admin chip and a menu for each', async () => {
    accountsApi([anna(), ben()]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['annaAdmin', 'ben']);
    expect(buttonIn(document, 'Aktionen für ben')).toBeTruthy();
  });

  it('offers resetting, admin rights and deleting in the menu', async () => {
    accountsApi([anna(), ben()]);
    wrapper = await page();

    const entries = await menuOf('ben');

    expect(entries.map((entry) => entry.textContent.trim())).toEqual([
      'Passwort zurücksetzen',
      'Zum Admin machen',
      'Löschen',
    ]);
    expect(
      entries.every((entry) => entry.getAttribute('aria-disabled') !== 'true'),
    ).toBe(true);
  });

  it('disables what would remove the last admin, with "Letzter Admin"', async () => {
    accountsApi([anna(), ben()]);
    wrapper = await page();

    const entries = await menuOf('anna');

    expect(
      entries.map((entry) => [
        entry.textContent.trim(),
        entry.getAttribute('aria-disabled') === 'true',
      ]),
    ).toEqual([
      ['Passwort zurücksetzen', false],
      ['Adminrechte entziehenLetzter Admin', true],
      ['LöschenLetzter Admin', true],
    ]);
  });

  it('grants admin rights and then revokes them while another admin remains', async () => {
    const calls = accountsApi([anna(), ben()]);
    wrapper = await page();

    await choose('ben', 'Zum Admin machen');

    expect(calls.at(-2)).toEqual({
      method: 'PATCH',
      url: '/api/accounts/2',
      body: { isAdmin: true },
    });
    expect(useSnackbar().value?.text).toBe('ben ist jetzt Admin');
    expect(rows(wrapper)).toEqual(['annaAdmin', 'benAdmin']);

    await choose('ben', 'Adminrechte entziehen');

    expect(calls.at(-2)?.body).toEqual({ isAdmin: false });
    expect(useSnackbar().value?.text).toBe('ben ist kein Admin mehr');
    expect(rows(wrapper)).toEqual(['annaAdmin', 'ben']);
  });

  it('shows the problem title when the server refuses to remove the last admin', async () => {
    accountsApi([anna(), ben(true)], [() => problem(409, LAST_ADMIN)]);
    wrapper = await page();

    await choose('ben', 'Adminrechte entziehen');

    expect(useSnackbar().value?.text).toBe(LAST_ADMIN.title);
  });

  it('leaves Konten after taking its own admin rights', async () => {
    accountsApi([anna(), ben(true)]);
    wrapper = await page();

    await choose('anna', 'Adminrechte entziehen');
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/verwalten');
    });
  });

  it('resets a password in a dialog, with a short one refused inline', async () => {
    const calls = accountsApi(
      [anna(), ben()],
      [
        () =>
          problem(422, {
            type: 'urn:performance:problem:validation',
            title: 'Bitte Eingaben prüfen',
            errors: { password: 'Mindestens 10 Zeichen.' },
          }),
      ],
    );
    wrapper = await page();

    await choose('ben', 'Passwort zurücksetzen');
    expect(dialog().textContent).toContain('Passwort von ben zurücksetzen');
    expect(dialog().textContent).toContain(
      'ben wird auf allen Geräten abgemeldet.',
    );
    await type('Neues Passwort', 'kurz');
    await click(buttonIn(dialog(), 'Speichern'));
    expect(dialog().textContent).toContain('Mindestens 10 Zeichen.');

    await type('Neues Passwort', 'neues-passwort-1');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.filter(({ method }) => method === 'PATCH').at(-1)).toEqual({
      method: 'PATCH',
      url: '/api/accounts/2',
      body: { password: 'neues-passwort-1' },
    });
    expect(
      dialog().querySelector<HTMLElement>('.v-overlay__content')?.style.display,
    ).toBe('none');
    expect(useSnackbar().value?.text).toBe('Passwort von ben zurückgesetzt');
  });

  it('deletes an account after the dialog says its entries stay', async () => {
    const calls = accountsApi([anna(), ben()]);
    wrapper = await page();

    await choose('ben', 'Löschen');
    expect(dialog().textContent).toContain('Konto ben löschen?');
    expect(dialog().textContent).toContain(
      'Einträge von ben bleiben erhalten.',
    );
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls.find(({ method }) => method === 'DELETE')?.url).toBe(
      '/api/accounts/2',
    );
    expect(rows(wrapper)).toEqual(['annaAdmin']);
    expect(useSnackbar().value?.text).toBe('ben gelöscht');
  });

  it('keeps an account whose deletion was cancelled', async () => {
    const calls = accountsApi([anna(), ben()]);
    wrapper = await page();

    await choose('ben', 'Löschen');
    await click(buttonIn(dialog(), 'Abbrechen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(false);
    expect(rows(wrapper)).toEqual(['annaAdmin', 'ben']);
  });
});
