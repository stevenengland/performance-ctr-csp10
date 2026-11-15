/** The one place that formats user-visible numbers and times (`de-DE`). */
const numberFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 2,
});

/** Points, scores and counters: up to two decimals, decimal comma, no trailing zeros. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** `HH:mm` in the browser's time zone unless one is given. */
export function formatTime(instant: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(instant);
}
