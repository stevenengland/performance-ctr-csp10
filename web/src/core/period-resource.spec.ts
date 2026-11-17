import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  createPeriodResource,
  type PeriodResource,
  usePeriodResource,
} from './period-resource';
import type { ConditionalFetch } from './polled-resource';

type Answer = Awaited<ReturnType<ConditionalFetch<string>>>;

/** A request the test answers when it chooses, so answers can arrive out of order. */
interface Request {
  selection: string;
  etag: string | undefined;
  answer(reply: Answer): Promise<void>;
}

/** A fake server for selections named by strings; `live` ones contain the present. */
function server(live: string[] = []) {
  const requests: Request[] = [];
  const resource = createPeriodResource<string, string>({
    key: (selection) => selection,
    live: (selection) => live.includes(selection),
    read: (selection) => (etag) =>
      new Promise<Answer>((resolve) => {
        requests.push({
          selection,
          etag,
          answer: async (reply) => {
            resolve(reply);
            await vi.advanceTimersByTimeAsync(0);
          },
        });
      }),
  });
  const sent = () => requests.map(({ selection, etag }) => [selection, etag]);
  return { resource, requests, sent };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('a period resource', () => {
  let resource: PeriodResource<string, string> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-15T22:41:00Z') });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    resource?.stop();
    resource = undefined;
    vi.useRealTimers();
  });

  it('reads the shown selection when a screen starts it and shows nothing of another selection while the new one loads', async () => {
    const fake = server();
    resource = fake.resource;
    resource.show('gestern');
    resource.start();
    await settle();
    await fake.requests[0]?.answer({ value: 'G', etag: '"g"' });
    expect(resource.state.value).toMatchObject({ value: 'G', stale: false });

    resource.show('vorgestern');
    await settle();

    expect(resource.state.value.value).toBeUndefined();
    await fake.requests[1]?.answer({ value: 'V', etag: '"v"' });
    expect(resource.state.value.value).toBe('V');
    expect(fake.sent()).toEqual([
      ['gestern', undefined],
      ['vorgestern', undefined],
    ]);
  });

  it('drops the answers for selections no longer shown, whatever order they arrive in', async () => {
    const fake = server();
    resource = fake.resource;
    resource.start();
    resource.show('a');
    resource.show('b');
    resource.show('a');
    await settle();
    const [firstA, b, secondA] = fake.requests;

    await secondA?.answer({ value: 'A2', etag: '"a2"' });
    await b?.answer({ value: 'B', etag: '"b"' });
    await firstA?.answer({ value: 'A1', etag: '"a1"' });

    expect(fake.sent()).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['a', undefined],
    ]);
    expect(resource.state.value.value).toBe('A2');
  });

  it('sends an ETag only with the selection it came from and applies a 304 only to it', async () => {
    const fake = server();
    resource = fake.resource;
    resource.start();
    resource.show('a');
    await settle();
    await fake.requests[0]?.answer({ value: 'A', etag: '"a"' });

    void resource.refresh();
    await settle();
    resource.show('b');
    await settle();
    await fake.requests[1]?.answer('unchanged');

    expect(resource.state.value.value).toBeUndefined();
    await fake.requests[2]?.answer({ value: 'B', etag: '"b"' });
    void resource.refresh();
    await settle();
    await fake.requests[3]?.answer('unchanged');
    expect(resource.state.value.value).toBe('B');
    expect(fake.sent()).toEqual([
      ['a', undefined],
      ['a', '"a"'],
      ['b', undefined],
      ['b', '"b"'],
    ]);
  });

  it('polls a selection that contains the present, and reads a closed one only when shown, on focus and after the device’s own writes', async () => {
    const fake = server(['heute']);
    resource = fake.resource;
    resource.start();
    resource.show('gestern');
    await settle();
    await fake.requests[0]?.answer({ value: 'G', etag: '"g"' });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.requests).toHaveLength(1);
    window.dispatchEvent(new Event('focus'));
    await settle();
    await fake.requests[1]?.answer('unchanged');
    void resource.refresh();
    await settle();
    await fake.requests[2]?.answer({ value: 'G2', etag: '"g2"' });
    expect(resource.state.value.value).toBe('G2');

    resource.show('heute');
    await settle();
    await fake.requests[3]?.answer({ value: 'H', etag: '"h"' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.sent().slice(1)).toEqual([
      ['gestern', '"g"'],
      ['gestern', '"g"'],
      ['heute', undefined],
      ['heute', '"h"'],
    ]);
  });

  it('reads nothing while no selection is shown', async () => {
    const fake = server(['heute']);
    resource = fake.resource;
    resource.start();
    resource.show('heute');
    await settle();
    await fake.requests[0]?.answer({ value: 'H', etag: '"h"' });

    resource.show(undefined);
    await vi.advanceTimersByTimeAsync(60_000);
    await resource.refresh();

    expect(fake.requests).toHaveLength(1);
    expect(resource.state.value).toEqual({ stale: false });
  });

  it('keeps the shown value while no screen runs it and asks on condition of its ETag when one starts it again', async () => {
    const fake = server();
    resource = fake.resource;
    resource.show('gestern');
    resource.start();
    await settle();
    await fake.requests[0]?.answer({ value: 'G', etag: '"g"' });

    resource.stop();
    resource.show('gestern');
    resource.start();

    expect(resource.state.value.value).toBe('G');
    await settle();
    expect(fake.sent()).toEqual([
      ['gestern', undefined],
      ['gestern', '"g"'],
    ]);
  });

  it('shows what the calling screen selects while its scope lives', async () => {
    const fake = server();
    resource = fake.resource;
    const selection = ref<string | undefined>('gestern');
    const scope = effectScope();
    const state = scope.run(() => usePeriodResource(fake.resource, selection));
    await settle();
    await fake.requests[0]?.answer({ value: 'G', etag: '"g"' });
    expect(state?.value.value).toBe('G');

    selection.value = 'vorgestern';
    await nextTick();
    await settle();
    scope.stop();
    window.dispatchEvent(new Event('focus'));
    await settle();

    expect(fake.sent()).toEqual([
      ['gestern', undefined],
      ['vorgestern', undefined],
    ]);
  });
});
