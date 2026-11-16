import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useToday } from './today';

describe('useToday', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    // 23:45 in Berlin.
    vi.useFakeTimers({ now: new Date('2026-11-15T22:45:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = zone;
  });

  /** Local midnight of the given Berlin date, as the instant it starts. */
  const berlinMidnight = (iso: string) => new Date(`${iso}T00:00:00+01:00`);

  it('starts at local midnight of the current day and moves on at the next one', () => {
    const scope = effectScope();
    const today = scope.run(() => useToday());

    expect(today?.value).toEqual(berlinMidnight('2026-11-15'));
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(today?.value).toEqual(berlinMidnight('2026-11-15'));
    vi.advanceTimersByTime(60 * 1000);
    expect(today?.value).toEqual(berlinMidnight('2026-11-16'));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(today?.value).toEqual(berlinMidnight('2026-11-17'));
    scope.stop();
  });

  it.each(['visibilitychange', 'focus', 'pageshow'])(
    'catches up on %s when the midnight timer did not run, as in a suspended tab',
    (resume) => {
      const scope = effectScope();
      const today = scope.run(() => useToday());

      vi.setSystemTime(new Date('2026-11-16T07:00:00Z'));
      const target = resume === 'visibilitychange' ? document : window;
      target.dispatchEvent(new Event(resume));

      expect(today?.value).toEqual(berlinMidnight('2026-11-16'));
      scope.stop();
    },
  );

  it('keeps the same value within a day, so dependants are not recomputed', () => {
    const scope = effectScope();
    const today = scope.run(() => useToday());
    const before = today?.value;

    vi.setSystemTime(new Date('2026-11-15T22:50:00Z'));
    window.dispatchEvent(new Event('focus'));

    expect(today?.value).toBe(before);
    scope.stop();
  });

  it('stops its timer and listeners when its scope ends', () => {
    const scope = effectScope();
    scope.run(() => useToday());
    const removed = vi.spyOn(window, 'removeEventListener');
    const removedFromDocument = vi.spyOn(document, 'removeEventListener');

    scope.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(removed.mock.calls.map(([type]) => type).sort()).toEqual([
      'focus',
      'pageshow',
    ]);
    expect(removedFromDocument.mock.calls.map(([type]) => type)).toEqual([
      'visibilitychange',
    ]);
    vi.restoreAllMocks();
  });
});
