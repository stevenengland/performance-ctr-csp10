import { messages } from './messages';

/** The one place that formats user-visible numbers and times (`de-DE`). */
const numberFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 2,
});

/** Points, scores and counters: up to two decimals, decimal comma, no trailing zeros. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const inputFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** A decimal to prefill a field with: like `formatNumber` but without grouping, so `parseDecimal` reads it back. */
export function formatDecimalInput(value: number): string {
  return inputFormat.format(value);
}

/** `HH:mm` in the browser's time zone unless one is given. */
export function formatTime(instant: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(instant);
}

/** Alcohol base points with their unit: `1 Punkt`, `3 Punkte`, `0,5 Punkte`. */
export function formatPoints(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? messages.points.one : messages.points.other}`;
}

/** A factor's multiplier: `×2`, `×1,5`. */
export function formatMultiplier(value: number): string {
  return `×${formatNumber(value)}`;
}

/** A decimal typed with a comma or a point (`0,5`, `0.5`); `null` when it is none. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  return /^-?\d+([.,]\d+)?$/.test(trimmed)
    ? Number(trimmed.replace(',', '.'))
    : null;
}
