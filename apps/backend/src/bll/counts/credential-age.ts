/**
 * Age of a stored credential (spec 028). Pure math: no Nest, no database and no clock,
 * so `now` always arrives as an argument and the assertions can pin dates.
 */

/** Settings key spec 012 already named; the threshold lives there and nowhere else. */
export const STALE_DAYS_KEY = 'counts.stale_days';

/** A quarter: what the user wants to be asked for unless he says otherwise. */
export const DEFAULT_STALE_DAYS = 90;

/** `0` is not "stale at once": it is the off switch of the reminder. */
export const MIN_STALE_DAYS = 0;
export const MAX_STALE_DAYS = 3650;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between the date of the credential and `now`, or `null` when there is no date:
 * the reminder never invents one. Fractions are floored, so a credential that has not
 * completed a day is not a day older.
 */
export function ageInDays(now: Date, since: Date | null): number | null {
  if (!since) return null;
  return Math.floor((now.getTime() - since.getTime()) / MS_PER_DAY);
}

/**
 * At or over the threshold counts, the same convention as the weak audit
 * (`strength_score <= threshold`). With the threshold at 0 it answers `false` for every age:
 * the off switch lives here, so a caller that forgets to check it cannot flag the whole
 * vault by accident.
 */
export function isStale(ageDays: number | null, staleDays: number): boolean {
  if (ageDays === null) return false;
  if (staleDays <= MIN_STALE_DAYS) return false;
  return ageDays >= staleDays;
}

/**
 * The threshold when it is an integer inside `0..3650`, `null` otherwise. `0` is a valid
 * value, never "missing". Numeric strings are accepted because the value read from settings
 * may have been written by hand; the caller decides what `null` means (a 400 on the write
 * path, the default on the read path), so this module imports no exception.
 */
export function parseStaleDays(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_STALE_DAYS || parsed > MAX_STALE_DAYS) return null;
  return parsed;
}
