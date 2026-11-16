import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { vi } from 'vitest';
import { defineComponent, h, type Component } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { createAppVuetify } from '../../theme';

/*
What the specs of the Verwalten list screens share: a fake API over one
collection, the mounted screen, and the controls of its teleported dialogs.
*/

export interface Call {
  method: string;
  url: string;
  body?: unknown;
}

export interface Item {
  id: number;
  name: string;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function problem(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/**
A fake API over one collection (`/api/persons` with key `persons`, …): writes
answer with the next given reply (or succeed), the list always reads the current
items, and reading one item adds `entryCount`. A created item gets the fields of
`created` the request does not send (a person's `photoUrl: null`); a changed one
keeps them.
*/
export function catalogApi<T extends Item>(
  path: string,
  key: string,
  items: T[],
  {
    entryCount = 5,
    replies = [] as (() => Response)[],
    created = {} as Partial<T>,
  } = {},
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : {};
      calls.push({ method, url, body });
      if (method === 'GET' && url === path) return json({ [key]: items });
      const reply = replies.shift();
      if (reply) return reply();
      const id = Number(url.split('/').pop());
      const index = items.findIndex((candidate) => candidate.id === id);
      if (method === 'GET') return json({ ...items[index], entryCount });
      if (method === 'DELETE') {
        items.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      const changed = {
        ...(method === 'POST' ? created : items[index]),
        id: method === 'POST' ? 9 : id,
        ...(body as object),
      } as T;
      if (index === -1) items.push(changed);
      else items.splice(index, 1, changed);
      return json(changed, method === 'POST' ? 201 : 200);
    }),
  );
  return calls;
}

/** jsdom lacks what Vuetify's dialogs position themselves with. */
export function stubDialogEnvironment() {
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
}

export async function mountPage(
  path: string,
  component: Component,
): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: path.split('?')[0] ?? path, component }],
  });
  await router.push(path);
  const shell = defineComponent(() => () => h(RouterView));
  const wrapper = mount(shell, {
    global: { plugins: [router, createAppVuetify()] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** Vuetify teleports dialogs to the body. */
export function dialog() {
  const found = document.querySelector('[role="dialog"]');
  if (!(found instanceof HTMLElement)) throw new Error('no dialog');
  return found;
}

export function buttonIn(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (button) =>
      button.getAttribute('aria-label') === name ||
      button.textContent.trim() === name,
  );
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

export function field(label: string): HTMLInputElement {
  const found = [...dialog().querySelectorAll('label')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  const input = document.getElementById(found?.htmlFor ?? '');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

export async function type(label: string, text: string) {
  const input = field(label);
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await flushPromises();
}

export async function click(button: HTMLButtonElement) {
  button.click();
  await flushPromises();
}

export const rows = (wrapper: VueWrapper) =>
  wrapper.findAll('.list__row').map((row) => row.text());
