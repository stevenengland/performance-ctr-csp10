import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import type { Factor } from '../../../core/api-client';
import { dismissSnackbar, useSnackbar } from '../../../core/snackbar';
import { createAppVuetify } from '../../../theme';
import FaktorenPage from './FaktorenPage.vue';

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function problem(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/**
A fake API over a list of factors: writes answer with the next given reply (or
succeed), and the list always reads the current factors.
*/
function api(factors: Factor[], ...replies: (() => Response)[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : {};
      calls.push({ method, url, body });
      if (method === 'GET' && url === '/api/factors') return json({ factors });
      const reply = replies.shift();
      if (reply) return reply();
      const id = Number(url.split('/').pop());
      if (method === 'GET') {
        const factor = factors.find((candidate) => candidate.id === id);
        return json({ ...factor, entryCount: 5 });
      }
      if (method === 'DELETE') {
        factors.splice(
          factors.findIndex((candidate) => candidate.id === id),
          1,
        );
        return new Response(null, { status: 204 });
      }
      const changed = { id: method === 'POST' ? 9 : id, ...(body as object) };
      factors.push(changed as Factor);
      return json(changed, method === 'POST' ? 201 : 200);
    }),
  );
  return calls;
}

async function page() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/verwalten/faktoren', component: FaktorenPage }],
  });
  await router.push('/verwalten/faktoren');
  const shell = defineComponent(() => () => h(RouterView));
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** Vuetify teleports dialogs to the body. */
function dialog() {
  const found = document.querySelector('[role="dialog"]');
  if (!(found instanceof HTMLElement)) throw new Error('no dialog');
  return found;
}

function buttonIn(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (button) =>
      button.getAttribute('aria-label') === name ||
      button.textContent.trim() === name,
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

function field(label: string): HTMLInputElement {
  const found = [...dialog().querySelectorAll('label')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  const input = document.getElementById(found?.htmlFor ?? '');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

async function type(label: string, text: string) {
  const input = field(label);
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}

async function click(button: HTMLButtonElement) {
  button.click();
  await flushPromises();
}

const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('.list__row').map((row) => row.text());

describe('Verwalten → Faktoren', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    dismissSnackbar();
    // jsdom lacks what Vuetify's dialogs position themselves with.
    vi.stubGlobal('visualViewport', {
      width: 390,
      height: 844,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('lists the factors with their multiplier, as the API sends them', async () => {
    api([
      { id: 2, name: 'Geburtstag', multiplier: 1.5 },
      { id: 1, name: 'Happy Hour', multiplier: 2 },
    ]);

    wrapper = await page();

    expect(rows(wrapper)).toEqual(['Geburtstag×1,5', 'Happy Hour×2']);
  });

  it('creates a factor with a decimal comma in the multiplier', async () => {
    const calls = api([]);
    wrapper = await page();

    await click(buttonIn(document, 'Faktor anlegen'));
    await type('Name', 'Geburtstag');
    await type('Multiplikator', '1,5');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'POST')?.body).toEqual({
      name: 'Geburtstag',
      multiplier: 1.5,
    });
    expect(rows(wrapper)).toEqual(['Geburtstag×1,5']);
  });

  it('shows the server’s field errors under their fields', async () => {
    api([], () =>
      problem(422, {
        title: 'Bitte Eingaben prüfen',
        errors: { multiplier: 'Zahl über 0 bis 99,99.' },
      }),
    );
    wrapper = await page();

    await click(buttonIn(document, 'Faktor anlegen'));
    await type('Name', 'Happy Hour');
    await type('Multiplikator', '0');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(dialog().textContent).toContain('Zahl über 0 bis 99,99.');
  });

  it('edits a factor in a dialog that starts with its values', async () => {
    const calls = api([{ id: 1, name: 'Happy Hour', multiplier: 2 }]);
    wrapper = await page();

    await click(buttonIn(document, 'Happy Hour bearbeiten'));
    expect(field('Name').value).toBe('Happy Hour');
    expect(field('Multiplikator').value).toBe('2');
    await type('Multiplikator', '2,5');
    await click(buttonIn(dialog(), 'Speichern'));

    expect(calls.find(({ method }) => method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/factors/1',
      body: { name: 'Happy Hour', multiplier: 2.5 },
    });
  });

  it('deletes a factor after a dialog that says its entries then count ×1', async () => {
    const calls = api([{ id: 1, name: 'Happy Hour', multiplier: 2 }]);
    wrapper = await page();

    await click(buttonIn(document, 'Happy Hour löschen'));
    expect(dialog().textContent).toContain('Happy Hour löschen?');
    expect(dialog().textContent).toContain('5 Einträge zählen danach ×1.');
    await click(buttonIn(dialog(), 'Löschen'));

    expect(calls.some(({ method }) => method === 'DELETE')).toBe(true);
    expect(useSnackbar().value?.text).toBe('Happy Hour gelöscht');
    expect(rows(wrapper)).toEqual([]);
  });
});
