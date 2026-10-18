/**
 * Distances as the design system writes them (design-system/README.md, Times and distances):
 * the short unit on screen ("1.2 km"), the long unit for screen readers ("1.2 kilometers"), both
 * from Intl.NumberFormat so plurals and decimals are the platform's, never joined by hand.
 *
 *   Kilometers: under 1 km in meters rounded to 10 (340 m), 1 to 10 km with one decimal (1.2 km),
 *               10 km and up in whole numbers (12 km).
 *   Miles:      under 0.1 mi in feet rounded to 10 (300 ft), one decimal under 10 mi (2.5 mi),
 *               whole numbers from 10 mi (12 mi).
 *   Approximate (the sharer rounds to about 500 m): the nearest 0.5 km or 0.5 mi, "about 1.5 km",
 *               or "under 1 km".
 */

export type Units = 'metric' | 'imperial';

export interface Spoken {
  /** On screen, with the short unit. */
  readonly text: string;
  /** For screen readers, with the long unit. */
  readonly spoken: string;
}

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

/** Regions whose people measure road distances in miles. */
const MILE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

/** The device's units, from its locale ("en-US" → imperial, "en-IN" → metric). */
export function unitsFor(locale: string): Units {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region !== undefined && MILE_REGIONS.has(region) ? 'imperial' : 'metric';
  } catch {
    return 'metric';
  }
}

type Unit = 'meter' | 'kilometer' | 'foot' | 'mile';

const formats = new Map<string, Intl.NumberFormat>();
function format(value: number, unit: Unit, display: 'short' | 'long', decimals: 0 | 1): string {
  const key = `${unit}|${display}|${String(decimals)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en', {
      style: 'unit',
      unit,
      unitDisplay: display,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formats.set(key, f);
  }
  return f.format(value);
}

const both = (value: number, unit: Unit, decimals: 0 | 1, prefix = ''): Spoken => ({
  text: prefix + format(value, unit, 'short', decimals),
  spoken: prefix + format(value, unit, 'long', decimals),
});

function precise(meters: number, units: Units): Spoken {
  if (units === 'metric') {
    if (meters < 995) return both(Math.max(10, Math.round(meters / 10) * 10), 'meter', 0);
    const km = meters / 1000;
    return km < 9.95 ? both(Math.round(km * 10) / 10, 'kilometer', 1) : both(Math.round(km), 'kilometer', 0);
  }
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return both(Math.max(10, Math.round((meters * FEET_PER_METER) / 10) * 10), 'foot', 0);
  return miles < 9.95 ? both(Math.round(miles * 10) / 10, 'mile', 1) : both(Math.round(miles), 'mile', 0);
}

function approximate(meters: number, units: Units): Spoken {
  const unit: Unit = units === 'metric' ? 'kilometer' : 'mile';
  const amount = units === 'metric' ? meters / 1000 : meters / METERS_PER_MILE;
  const half = Math.round(amount * 2) / 2;
  if (half < 1) return both(1, unit, 0, 'under ');
  return both(half, unit, Number.isInteger(half) ? 0 : 1, 'about ');
}

/** A distance in the device's units: "340 m", "1.2 km", "about 1.5 km", "under 1 mi". */
export function formatDistance(meters: number, units: Units, isApproximate: boolean): Spoken {
  return isApproximate ? approximate(meters, units) : precise(meters, units);
}
