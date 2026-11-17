import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { ApiProblem } from './api-client';
import {
  createPolledResource,
  createPolledResources,
  usePolledResource,
  type ConditionalFetch,
  type PolledResource,
} from './polled-resource';
import { dismissSnackbar, useSnackbar } from './snackbar';

type Answer = Awaited<ReturnType<ConditionalFetch<string>>>;
type Reply = () => Answer | Promise<Answer>;

const value =
  (text: string, etag = `"${text}"`): Reply =>
  () => ({
    value: text,
    etag,
  });
const unchanged: Reply = () => 'unchanged';
const offline: Reply = () => Promise.reject(new TypeError('Failed to fetch'));
const maintenance =
  (retryAfterSeconds: number): Reply =>
  () =>
    Promise.reject(
      new ApiProblem(
        503,
        'urn:performance:problem:maintenance',
        'Wird aktualisiert – gleich wieder da',
        retryAfterSeconds,
      ),
    );

/** A fake server: each fetch takes the next reply (the last one repeats); the ETags it was sent are recorded. */
function server(...replies: Reply[]) {
  const etags: (string | undefined)[] = [];
  const fetch: ConditionalFetch<string> = (etag) => {
    etags.push(etag);
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (!reply) throw new Error('no reply');
    return Promise.resolve(reply());
  };
  return { fetch, etags };
}

let visibility: DocumentVisibilityState = 'visible';
function becomeVisible(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

async function wait(seconds: number) {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
}

describe('a polled resource', () => {
  let resource: PolledResource<string> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-15T22:41:00Z') });
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    dismissSnackbar();
  });

  afterEach(() => {
    resource?.stop();
    resource = undefined;
    vi.useRealTimers();
  });

  it('fetches as soon as a screen starts it and every 10 s on condition of the last ETag; unchanged keeps the value', async () => {
    const { fetch, etags } = server(value('a', '"1"'), unchanged);
    resource = createPolledResource(fetch);

    resource.start();
    await settle();
    expect(resource.state.value).toMatchObject({ value: 'a', stale: false });

    await wait(9.9);
    expect(etags).toEqual([undefined]);
    await wait(0.1);
    await wait(10);

    expect(etags).toEqual([undefined, '"1"', '"1"']);
    expect(resource.state.value.value).toBe('a');
    expect(resource.state.value.updatedAt).toEqual(
      new Date('2026-11-15T22:41:20Z'),
    );
  });

  it('pauses while hidden, fetches at once when visible again and on focus', async () => {
    const { fetch, etags } = server(value('a'));
    resource = createPolledResource(fetch);
    resource.start();
    await settle();

    becomeVisible('hidden');
    await wait(60);
    expect(etags).toHaveLength(1);

    becomeVisible('visible');
    await settle();
    expect(etags).toHaveLength(2);

    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(etags).toHaveLength(3);
  });

  it('fetches at once after the device’s own writes and polls 10 s from then', async () => {
    const { fetch, etags } = server(value('a'), value('b'));
    resource = createPolledResource(fetch);
    resource.start();
    await settle();
    await wait(6);

    await resource.refresh();
    expect(resource.state.value.value).toBe('b');

    await wait(9.9);
    expect(etags).toHaveLength(2);
    await wait(0.1);
    expect(etags).toHaveLength(3);
  });

  it('drops an answer that a newer request overtook', async () => {
    let answerFirst: (answer: Answer) => void = () => undefined;
    const { fetch } = server(
      () =>
        new Promise<Answer>((resolve) => {
          answerFirst = resolve;
        }),
      value('new'),
    );
    resource = createPolledResource(fetch);
    resource.start();

    await resource.refresh();
    answerFirst({ value: 'old', etag: '"old"' });
    await settle();

    expect(resource.state.value.value).toBe('new');
  });

  it('forgets the value and its ETag on reset, drops the answer still on its way and fetches anew', async () => {
    let answerBefore: (answer: Answer) => void = () => undefined;
    const { fetch, etags } = server(
      value('a'),
      () =>
        new Promise<Answer>((resolve) => {
          answerBefore = resolve;
        }),
      value('b'),
    );
    resource = createPolledResource(fetch);
    resource.start();
    await settle();
    void resource.refresh();

    resource.reset();
    expect(resource.state.value).toEqual({ stale: false });
    answerBefore({ value: 'old', etag: '"old"' });
    await settle();

    expect(resource.state.value.value).toBe('b');
    expect(etags).toEqual([undefined, '"a"', undefined]);
  });

  it('forgets the value, its ETag and its staleness on clear, drops the answer on its way and asks nothing until the next refresh', async () => {
    let answerBefore: (answer: Answer) => void = () => undefined;
    const { fetch, etags } = server(
      value('a'),
      () =>
        new Promise<Answer>((resolve) => {
          answerBefore = resolve;
        }),
      value('b'),
    );
    resource = createPolledResource(fetch);
    resource.start();
    await settle();
    void resource.refresh();

    resource.clear();
    answerBefore({ value: 'old', etag: '"old"' });
    await wait(60);

    expect(resource.state.value).toEqual({ stale: false });
    expect(etags).toEqual([undefined, '"a"']);
    await resource.refresh();
    expect(resource.state.value.value).toBe('b');
    expect(etags).toEqual([undefined, '"a"', undefined]);
  });

  it('keeps the last value with the time it was confirmed when a refresh fails, and retries with backoff up to 60 s', async () => {
    const { fetch, etags } = server(value('a'), offline);
    resource = createPolledResource(fetch);
    resource.start();
    await settle();

    const retries: number[] = [];
    let seconds = 0;
    let seen = etags.length;
    while (retries.length < 7) {
      await wait(1);
      seconds += 1;
      if (etags.length > seen) {
        retries.push(seconds);
        seconds = 0;
        seen = etags.length;
      }
    }

    expect(retries).toEqual([10, 5, 10, 20, 40, 60, 60]);
    expect(resource.state.value).toEqual({
      value: 'a',
      updatedAt: new Date('2026-11-15T22:41:00Z'),
      stale: true,
    });
  });

  it('is current again after the next successful refresh', async () => {
    const { fetch } = server(offline, value('a'));
    resource = createPolledResource(fetch);
    resource.start();
    await settle();
    expect(resource.state.value.stale).toBe(true);

    await wait(5);

    expect(resource.state.value).toMatchObject({ value: 'a', stale: false });
  });

  it('shows the maintenance snackbar on 503 and retries after its Retry-After', async () => {
    const { fetch, etags } = server(value('a'), maintenance(3), value('b'));
    resource = createPolledResource(fetch);
    resource.start();
    await settle();
    await wait(10);

    expect(useSnackbar().value?.text).toBe(
      'Wird aktualisiert – gleich wieder da',
    );
    await wait(2.9);
    expect(etags).toHaveLength(2);
    await wait(0.1);
    expect(etags).toHaveLength(3);
    expect(resource.state.value.value).toBe('b');
  });

  it('marks the value gone on 404 and stops polling, keeping the last value', async () => {
    const notFound: Reply = () =>
      Promise.reject(
        new ApiProblem(
          404,
          'urn:performance:problem:not-found',
          'Nicht gefunden',
        ),
      );
    const { fetch, etags } = server(value('a'), notFound);
    resource = createPolledResource(fetch);
    resource.start();
    await settle();
    expect(resource.state.value.gone).toBeFalsy();

    await wait(10);
    expect(resource.state.value).toMatchObject({ value: 'a', gone: true });
    await wait(120);

    expect(etags).toHaveLength(2);
  });

  it('runs while any screen needs it and stops polling and listening when the last one closes', async () => {
    const { fetch, etags } = server(value('a'));
    resource = createPolledResource(fetch);
    resource.start();
    resource.start();
    await settle();
    expect(etags).toHaveLength(1);

    resource.stop();
    await wait(10);
    expect(etags).toHaveLength(2);

    resource.stop();
    await wait(60);
    window.dispatchEvent(new Event('focus'));
    becomeVisible('visible');
    await settle();
    expect(etags).toHaveLength(2);
  });

  it('fetches once on refresh without a screen and does not poll on', async () => {
    const { fetch, etags } = server(value('a'));
    resource = createPolledResource(fetch);

    await resource.refresh();
    await wait(60);

    expect(etags).toHaveLength(1);
    expect(resource.state.value.value).toBe('a');
  });

  it('runs for the calling screen while its scope lives', async () => {
    const { fetch, etags } = server(value('a'));
    const running = createPolledResource(fetch);
    resource = running;
    const scope = effectScope();

    const state = scope.run(() => usePolledResource(running));
    await settle();
    expect(state?.value.value).toBe('a');

    scope.stop();
    await wait(60);
    expect(etags).toHaveLength(1);
  });
});

describe('keyed polled resources', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keep one resource per key, fetching for that key', async () => {
    const asked: number[] = [];
    const resources = createPolledResources<number, string>(
      (key) => async () => {
        asked.push(key);
        return { value: `game ${String(key)}`, etag: undefined };
      },
    );

    expect(resources.of(1)).toBe(resources.of(1));
    expect(resources.of(1)).not.toBe(resources.of(2));
    await resources.of(2).refresh();

    expect(asked).toEqual([2]);
    expect(resources.of(2).state.value.value).toBe('game 2');
  });

  it('forget a key: its next use starts empty', async () => {
    const resources = createPolledResources<number, string>(() => async () => ({
      value: 'a',
      etag: '"1"',
    }));
    const first = resources.of(1);
    await first.refresh();

    resources.forget(1);

    expect(resources.of(1)).not.toBe(first);
    expect(resources.of(1).state.value).toEqual({ stale: false });
  });
});
