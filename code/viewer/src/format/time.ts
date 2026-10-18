/**
 * Times as the product writes them: "9:41 pm" on a 12-hour device, "21:41" on a 24-hour one
 * (design-system/README.md: use the device's time format). Recency ticks on screen in short units
 * ("12 s ago", tabular figures in CSS) and is spoken with Intl.RelativeTimeFormat ("12 seconds
 * ago"), never "s" or "min".
 */

export interface ClockStyle {
  readonly hour12: boolean;
}

/** Whether the device's locale reads the clock in 12 hours ("en-US") or 24 ("en-GB", "de"). */
export function clockStyleFor(locale: string): ClockStyle {
  try {
    const { hourCycle } = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    return { hour12: hourCycle === 'h11' || hourCycle === 'h12' };
  } catch {
    return { hour12: true };
  }
}

/** "9:41 pm" or "21:41". */
export function formatTime(date: Date, style: ClockStyle): string {
  const h = date.getHours();
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!style.hour12) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${String(h % 12 || 12)}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

const seconds = (ms: number): number => Math.max(0, Math.round(ms / 1000));

/** The bar's ticking recency: "just now", "12 s ago", "3 min ago". */
export function agoShort(ms: number): string {
  const s = seconds(ms);
  if (s < 2) return 'just now';
  return s < 60 ? `${String(s)} s ago` : `${String(Math.round(s / 60))} min ago`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });

/** The same for screen readers: "now", "12 seconds ago", "3 minutes ago". */
export function agoSpoken(ms: number): string {
  const s = seconds(ms);
  if (s < 2) return relative.format(0, 'second');
  return s < 60 ? relative.format(-s, 'second') : relative.format(-Math.round(s / 60), 'minute');
}
