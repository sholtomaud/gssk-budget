/* Money is signed integer minor units everywhere (REQ-DATA-2a). It is divided
 * only at the display edge, which is here — nowhere else may do it. */

export const MINOR_UNITS_PER_MAJOR = 100;

/** Format minor units for display. Never used to compute with. */
export function formatMinor(minor: number, currency = 'AUD', locale = 'en-AU'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(minor / MINOR_UNITS_PER_MAJOR);
}

/* The model carries minor units as doubles. A 30-year daily forecast must stay
 * inside Number.MAX_SAFE_INTEGER or the ledger silently loses cents. */
export function assertWithinSafeRange(minor: number, what: string): number {
  if (!Number.isFinite(minor) || Math.abs(minor) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${what} is outside the safe integer range for minor units: ${minor}`);
  }
  return minor;
}
