import { describe, expect, it } from 'vitest';
import {
  formatDay,
  formatDecimalInput,
  formatFullDay,
  formatMultiplier,
  formatNumber,
  formatPoints,
  formatSigned,
  formatTime,
  formatWeekdayDay,
  parseDecimal,
} from './format';

describe('de-DE formatting', () => {
  it.each([
    [4.5, '4,5'],
    [12, '12'],
    [0.25, '0,25'],
    [1.005, '1,01'],
    [9999.99, '9.999,99'],
  ])(
    'shows %d as %s: up to two decimals, comma, no trailing zeros',
    (value, text) => {
      expect(formatNumber(value)).toBe(text);
    },
  );

  it.each([
    [-20, '−20'],
    [-1234, '−1.234'],
    [0, '0'],
    [35, '35'],
  ])(
    'shows game points %d as %s, negative with a real minus sign',
    (value, text) => {
      expect(formatSigned(value)).toBe(text);
    },
  );

  it('shows a day as dd.MM. without the year in the given time zone', () => {
    const instant = new Date('2026-09-14T22:30:00Z');
    expect(formatDay(instant, 'Europe/Berlin')).toBe('15.09.');
    expect(formatDay(instant, 'America/Mexico_City')).toBe('14.09.');
  });

  it('shows a day with its short weekday and without the year, and in full', () => {
    const instant = new Date('2026-11-15T23:30:00Z');
    expect(formatWeekdayDay(instant, 'Europe/Berlin')).toBe('Mo., 16.11.');
    expect(formatFullDay(instant, 'Europe/Berlin')).toBe('Montag, 16.11.2026');
    expect(formatFullDay(instant, 'America/Mexico_City')).toBe(
      'Sonntag, 15.11.2026',
    );
  });

  it('shows times as HH:mm in the given time zone', () => {
    const instant = new Date('2026-11-15T22:41:00Z');
    expect(formatTime(instant, 'Europe/Berlin')).toBe('23:41');
    expect(formatTime(instant, 'America/Mexico_City')).toBe('16:41');
  });

  it.each([
    [1, '1 Punkt'],
    [3, '3 Punkte'],
    [0.5, '0,5 Punkte'],
    [0, '0 Punkte'],
  ])('shows %d points as %s', (value, text) => {
    expect(formatPoints(value)).toBe(text);
  });

  it.each([
    [2, '×2'],
    [1.5, '×1,5'],
    [0.25, '×0,25'],
    [99.99, '×99,99'],
  ])('shows multiplier %d as %s', (value, text) => {
    expect(formatMultiplier(value)).toBe(text);
  });

  it.each([
    [9999.99, '9999,99'],
    [1000, '1000'],
    [1.5, '1,5'],
    [2, '2'],
  ])(
    'prefills a field with %d as %s, which reads back as the same number',
    (value, text) => {
      expect(formatDecimalInput(value)).toBe(text);
      expect(parseDecimal(formatDecimalInput(value))).toBe(value);
    },
  );

  it.each([
    ['0,5', 0.5],
    ['0.5', 0.5],
    [' 3 ', 3],
    ['9999,99', 9999.99],
    ['-1', -1],
  ])('reads %s with a decimal comma or point as %d', (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it.each(['', 'eins', '1,5,0', '9.999,99', '1e3', ','])(
    'reads %s as no number',
    (text) => {
      expect(parseDecimal(text)).toBeNull();
    },
  );
});
