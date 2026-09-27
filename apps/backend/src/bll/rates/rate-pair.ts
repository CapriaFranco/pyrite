import type { CurrencyCode } from '../../types/currencies';

/**
 * Resolving a rate for a pair (spec 027), with no Nest and no database so it is testable with plain
 * series. A quotation exists for one pair and one day; the question this answers is "what rate
 * applies to change `from` into `to`", which may be the direct quotation, its inverse, or a
 * composition through the base currency.
 */

export interface RatePoint {
  type: string;
  base: string;
  quote: string;
  buy: number;
  sell: number;
  date: string;
}

export interface RateResolution {
  /** How many units of `to` one unit of `from` is worth, at the mid of every leg used. */
  rate: number;
  /**
   * The exact sides of the quotation, present only when the pair exists directly: on an inverse or a
   * crossed pair there is no honest `buy`/`sell` for the pair asked for, and inventing one would be
   * worse than not offering it.
   */
  buy?: number;
  sell?: number;
  /** How the rate was obtained, so the caller can show it and audit it. */
  kind: 'direct' | 'inverse' | 'cross';
  /** The quotations that took part, in the order they were combined. */
  used: Array<{ type: string; base: string; quote: string; date: string }>;
}

/**
 * Rounding is not this module's business: the rate travels at full precision and whoever presents it
 * decides how many decimals to show. Rounding each leg before multiplying would drift the result.
 */
const mid = (point: RatePoint): number => (point.buy + point.sell) / 2;

/** The newest point of a pair, optionally of one type. */
function pick(series: RatePoint[], base: string, quote: string, type?: string): RatePoint | null {
  const candidates = series
    .filter((point) => point.base === base && point.quote === quote)
    .filter((point) => (type ? point.type === type : true));
  if (candidates.length === 0) return null;
  return candidates.reduce((newest, point) => (point.date > newest.date ? point : newest));
}

/**
 * The rate that turns `from` into `to`. Returns null when there is no path at all: the utility never
 * invents a rate, and the caller decides what to do with the absence.
 */
export function resolveRate(
  series: RatePoint[],
  from: string,
  to: string,
  baseCurrency: CurrencyCode | string = 'ARS',
  type?: string,
): RateResolution | null {
  if (from === to) return { rate: 1, kind: 'direct', used: [] };

  const direct = pick(series, from, to, type);
  if (direct) {
    return {
      rate: mid(direct),
      buy: direct.buy,
      sell: direct.sell,
      kind: 'direct',
      used: [describe(direct)],
    };
  }

  const inverse = pick(series, to, from, type);
  if (inverse && mid(inverse) !== 0) {
    return { rate: 1 / mid(inverse), kind: 'inverse', used: [describe(inverse)] };
  }

  // Only through the base currency: from -> base and base -> to. Each leg is resolved with the same
  // rules one level down, so an inverted leg is handled like any other.
  if (from !== baseCurrency && to !== baseCurrency) {
    const first =
      pick(series, from, baseCurrency, type) ?? pick(series, baseCurrency, from, type);
    const second =
      pick(series, baseCurrency, to, type) ?? pick(series, to, baseCurrency, type);
    const firstResolution = first ? resolveRate([first], from, baseCurrency, baseCurrency, type) : null;
    const secondResolution = second ? resolveRate([second], baseCurrency, to, baseCurrency, type) : null;
    if (firstResolution && secondResolution) {
      return {
        rate: firstResolution.rate * secondResolution.rate,
        kind: 'cross',
        used: [...firstResolution.used, ...secondResolution.used],
      };
    }
  }

  return null;
}

function describe(point: RatePoint): { type: string; base: string; quote: string; date: string } {
  return { type: point.type, base: point.base, quote: point.quote, date: point.date };
}
