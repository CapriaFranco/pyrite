import type { ArgentinaDatosCurrencyRow, ArgentinaDatosRow } from '../../integrations/argentinadatos.client';
import type { CurrencyCode } from '../../types/currencies';

/**
 * Turning a provider's rows into rate entries (spec 030), with no Nest and no database so it is
 * assertable with plain rows - the same reason `rate-pair.ts` exists. What a provider gives and
 * which pair it means changes per source; the wiring (which client feeds which mapping, the upsert,
 * the error handling) stays in the service.
 */

export interface RateEntry {
  type: string;
  /** The pair of the quotation (spec 027): both sides are codes of the currency catalog. */
  base: string;
  quote: string;
  buy: number;
  sell: number;
  date: string;
}

/** The dollar's full series (eight houses) is quoted against the peso. */
export const PROVIDER_PAIR = { base: 'USD', quote: 'ARS' };

/** The currency the currency endpoint quotes against. */
export const CURRENCY_QUOTE = 'ARS';

/** The source's own name for the single quotation each currency of that endpoint carries. */
export const DEFAULT_CURRENCY_TYPE = 'oficial';

/**
 * The currencies ingested from the currency endpoint (spec 030): one entry per catalog code. Adding
 * a currency is this entry plus its code in the catalog, nothing else.
 */
export const INGESTED_CURRENCIES: readonly CurrencyCode[] = ['EUR'];

/** The dollar's rows: a quotation without both sides or before `fromDate` is not stored. */
export function mapDollarRows(rows: ArgentinaDatosRow[], fromDate: string): RateEntry[] {
  return rows
    .filter((r) => r.casa && r.venta != null && r.compra != null && r.fecha >= fromDate)
    .map((r) => ({ type: r.casa, ...PROVIDER_PAIR, buy: r.compra, sell: r.venta, date: r.fecha }));
}

/**
 * The currency rows, kept to the declared currencies and written with the pair explicit: the row
 * says which currency it is, the pair says against what. The dollar is dropped on purpose (it has
 * its own provider and eight houses; two writers of the same pair would be two sources of truth),
 * and a row without `casa` takes the only name this endpoint's series has instead of being lost.
 */
export function mapCurrencyRows(
  rows: ArgentinaDatosCurrencyRow[],
  fromDate: string,
  currencies: readonly CurrencyCode[] = INGESTED_CURRENCIES,
): RateEntry[] {
  return rows
    .filter(
      (r) =>
        (currencies as readonly string[]).includes(r.moneda) &&
        r.venta != null &&
        r.compra != null &&
        r.fecha >= fromDate,
    )
    .map((r) => ({
      type: r.casa ?? DEFAULT_CURRENCY_TYPE,
      base: r.moneda,
      quote: CURRENCY_QUOTE,
      buy: r.compra,
      sell: r.venta,
      date: r.fecha,
    }));
}

/** A series the daily cross-check watches: named and paired, so a silent one is visible by itself. */
export interface WatchedFeed {
  name: string;
  type: string;
  base: string;
  quote: string;
}

export const WATCHED_FEEDS: readonly WatchedFeed[] = [
  { name: 'blue', type: 'blue', base: PROVIDER_PAIR.base, quote: PROVIDER_PAIR.quote },
  { name: 'euro', type: DEFAULT_CURRENCY_TYPE, base: 'EUR', quote: CURRENCY_QUOTE },
];

/** The warning for a feed that stopped publishing, or null when its last day is current enough. */
export function staleFeedWarning(
  feed: WatchedFeed,
  lastDate: string | undefined,
  now: number = Date.now(),
  maxDays = 2,
): string | null {
  if (!lastDate) return `Daily check: ${feed.name} has no data at all`;
  const daysBehind = (now - new Date(lastDate).getTime()) / 86_400_000;
  if (daysBehind <= maxDays) return null;
  return `Daily check: ${feed.name} ${Math.floor(daysBehind)} days behind (last=${lastDate})`;
}
