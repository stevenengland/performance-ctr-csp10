import { describe, expect, it } from 'vitest';
import { formatNumber, formatTime } from './format';

describe('de-DE formatting', () => {
  it.each([
    [4.5, '4,5'],
    [12, '12'],
    [0.25, '0,25'],
    [1.005, '1,01'],
    [9999.99, '9.999,99'],
  ])('shows %d as %s: up to two decimals, comma, no trailing zeros', (value, text) => {
    expect(formatNumber(value)).toBe(text);
  });

  it('shows times as HH:mm in the given time zone', () => {
    const instant = new Date('2026-11-15T22:41:00Z');
    expect(formatTime(instant, 'Europe/Berlin')).toBe('23:41');
    expect(formatTime(instant, 'America/Mexico_City')).toBe('16:41');
  });
});
