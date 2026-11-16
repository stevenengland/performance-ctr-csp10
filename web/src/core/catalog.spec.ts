import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Person } from './api-client';
import {
  createPerson,
  loadPersons,
  putPersonPhoto,
  usePersons,
} from './catalog';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
A fake API whose writes answer at once and whose list reads wait until the test
answers them, in any order, with the list it gives.
*/
function server() {
  const reads: ((persons: Person[]) => void)[] = [];
  let nextId = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = `${init.method ?? 'GET'} ${url}`;
      if (call === 'GET /api/persons') {
        return new Promise<Response>((answer) =>
          reads.push((persons) => answer(json({ persons }))),
        );
      }
      if (call === 'POST /api/persons') {
        const { name } = JSON.parse(String(init.body)) as { name: string };
        return json({ id: nextId++, name, photoUrl: null }, 201);
      }
      const photo = /^PUT \/api\/persons\/(\d+)\/photo$/.exec(call);
      if (photo) {
        return json({
          id: Number(photo[1]),
          name: 'Anna',
          photoUrl: `/api/persons/${String(photo[1])}/photo?v=new`,
        });
      }
      throw new Error(`unexpected ${call}`);
    }),
  );
  /** Answers the `index`th list read (counting from 0) with `persons`. */
  async function answer(index: number, persons: Person[]) {
    await flushPromises();
    const read = reads[index];
    if (!read) throw new Error(`no read ${String(index)}`);
    read(persons);
  }
  return { answer };
}

const names = () => usePersons().value?.map(({ name }) => name);

describe('the persons list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a later save when an earlier save’s reload answers last', async () => {
    const { answer } = server();
    const initial = loadPersons();
    await answer(0, []);
    await initial;

    const anna = await createPerson('Anna');
    const reloadA = loadPersons();
    const ben = await createPerson('Ben');
    const reloadB = loadPersons();
    await answer(2, [anna, ben]);
    await reloadB;
    await answer(1, [anna]);
    await reloadA;

    expect(names()).toEqual(['Anna', 'Ben']);
  });

  it('keeps an acknowledged write when a reload that started before it answers', async () => {
    const { answer } = server();
    const initial = loadPersons();
    await answer(0, []);
    await initial;
    const anna = await createPerson('Anna');

    const reload = loadPersons();
    const withPhoto = await putPersonPhoto(anna.id, 'AAAA');
    await answer(1, [anna]);
    await reload;

    expect(usePersons().value).toEqual([withPhoto]);
  });

  it('takes the answer of the latest reload', async () => {
    const { answer } = server();
    const first = loadPersons();
    const second = loadPersons();
    const anna: Person = { id: 1, name: 'Anna', photoUrl: null };

    await answer(1, [anna]);
    await second;
    await answer(0, []);
    await first;

    expect(usePersons().value).toEqual([anna]);
  });
});
