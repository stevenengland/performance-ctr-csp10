import { afterEach, describe, expect, it } from 'vitest';
import { startOfToday, todayFrom } from './day-window';

describe('the day window ("Heute")', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  it.each([
    ['Europe/Berlin', '2026-11-15T22:41:00Z', '2026-11-14T23:00:00.000Z'],
    ['Europe/Berlin', '2026-11-14T23:30:00Z', '2026-11-14T23:00:00.000Z'],
    ['America/Mexico_City', '2026-11-15T05:30:00Z', '2026-11-14T06:00:00.000Z'],
    ['UTC', '2026-11-15T00:00:00Z', '2026-11-15T00:00:00.000Z'],
  ])(
    'starts at local midnight in %s and is sent as a UTC instant (%s → %s)',
    (timeZone, now, from) => {
      process.env.TZ = timeZone;

      expect(todayFrom(new Date(now))).toBe(from);
    },
  );

  it('follows daylight saving time: the day after the clocks went back starts at 23:00 UTC again', () => {
    process.env.TZ = 'Europe/Berlin';

    expect(todayFrom(new Date('2026-10-25T12:00:00Z'))).toBe(
      '2026-10-24T22:00:00.000Z',
    );
    expect(todayFrom(new Date('2026-10-26T12:00:00Z'))).toBe(
      '2026-10-25T23:00:00.000Z',
    );
  });

  it('starts on the day that is local now, not the UTC day', () => {
    process.env.TZ = 'Pacific/Auckland';

    expect(startOfToday(new Date('2026-11-14T12:00:00Z')).toISOString()).toBe(
      '2026-11-14T11:00:00.000Z',
    );
  });
});
