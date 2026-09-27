import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ArgentinaDatosClient } from '../../integrations/argentinadatos.client';
import { DolarApiClient, type DolarApiRate } from '../../integrations/dolarapi.client';
import { RatesRepository } from '../../dal/rates/rates.repository';
import { SettingsService } from '../settings/settings.service';
import { isCurrencyCode, type CurrencyCode } from '../../types/currencies';
import { resolveRate, type RateResolution } from './rate-pair';
import {
  mapCurrencyRows,
  mapDollarRows,
  PROVIDER_PAIR,
  staleFeedWarning,
  WATCHED_FEEDS,
  type RateEntry,
} from './rates-sources';

export type { RateEntry };

/** The currency equivalences are expressed in, as a setting (spec 027). */
export const BASE_CURRENCY_KEY = 'finances.base_currency';
const DEFAULT_BASE_CURRENCY: CurrencyCode = 'ARS';

@Injectable()
export class RatesService {
  private readonly log = new Logger(RatesService.name);
  private intradiaRates: DolarApiRate[] | null = null;
  private lastReconcileAt = 0;

  constructor(
    private readonly argData: ArgentinaDatosClient,
    private readonly dolarApi: DolarApiClient,
    private readonly ratesRepo: RatesRepository,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The full reconcile (spec 030) runs one leg per source: the dollar's eight houses and the
   * declared currencies of the currency endpoint. The legs are independent on purpose: a euro
   * failure is logged with its source and stops neither the dollar nor the boot, while a dollar
   * failure is kept and rethrown after both legs ran, so it surfaces exactly as it did before and
   * the euro still gets its chance.
   */
  async reconcileFull(): Promise<number> {
    const fromDate = process.env.RATES_SYNC_FROM ?? '2025-01-01';
    let count = 0;
    let dollarError: unknown;

    try {
      const dollars = mapDollarRows(await this.argData.fetchFullSeries(), fromDate);
      await this.ratesRepo.upsertMany(dollars);
      count += dollars.length;
      this.log.log(`Reconcile dolares: ${dollars.length} entries (from ${fromDate})`);
    } catch (error: unknown) {
      dollarError = error;
    }

    try {
      const currencies = mapCurrencyRows(await this.argData.fetchCurrencies(), fromDate);
      await this.ratesRepo.upsertMany(currencies);
      count += currencies.length;
      this.log.log(`Reconcile monedas: ${currencies.length} entries (from ${fromDate})`);
    } catch (error: unknown) {
      this.log.warn(`Reconcile monedas failed: ${message(error)}`);
    }

    if (dollarError) throw dollarError;
    this.lastReconcileAt = Date.now();
    this.log.log(`Reconcile complete: ${count} entries (from ${fromDate})`);
    return count;
  }

  async refreshIntradia(): Promise<void> {
    this.intradiaRates = await this.dolarApi.fetchAll();
  }

  /**
   * The newest point of a type. Without a pair filter it answers the pair the providers quote
   * against the peso (spec 030): a type can now hold two quotations (`oficial` is the dollar's and
   * the euro's), and this read must not become a coin toss between them.
   */
  async getLatest(type: string, base?: string, quote?: string): Promise<RateEntry | undefined> {
    if (this.intradiaRates && !base && !quote) {
      const intradia = this.intradiaRates.find((r) => r.casa === type);
      if (intradia) {
        return {
          type,
          ...PROVIDER_PAIR,
          buy: intradia.compra,
          sell: intradia.venta,
          date: new Date().toISOString().slice(0, 10),
        };
      }
    }
    const row = await this.ratesRepo.getLatest(type, base ?? PROVIDER_PAIR.base, quote ?? PROVIDER_PAIR.quote);
    return row ? { ...row, type } : undefined;
  }

  async getSeries(type: string, from?: string, to?: string, base?: string, quote?: string): Promise<RateEntry[]> {
    const rows = await this.ratesRepo.getSeries(
      type,
      from,
      to,
      base ?? PROVIDER_PAIR.base,
      quote ?? PROVIDER_PAIR.quote,
    );
    return rows.map((r) => ({ ...r, type }));
  }

  /**
   * The rate that turns `from` into `to` (spec 027). It resolves the pair the way it exists: the
   * direct quotation, its inverse, or a composition through the base currency. When there is no path
   * at all it answers 404 instead of inventing a number.
   */
  async convert(from: unknown, to: unknown, type?: unknown): Promise<{
    from: string;
    to: string;
    type: string | null;
    baseCurrency: string;
    rate: number;
    buy?: number;
    sell?: number;
    kind: RateResolution['kind'];
    used: RateResolution['used'];
  }> {
    if (!isCurrencyCode(from)) throw new BadRequestException('unknown currency in from');
    if (!isCurrencyCode(to)) throw new BadRequestException('unknown currency in to');
    const wantedType = typeof type === 'string' && type !== '' ? type : undefined;
    const series = await this.ratesRepo.findLatestPoints();
    const baseCurrency = this.baseCurrency();
    const resolution = resolveRate(series, from, to, baseCurrency, wantedType);
    if (!resolution) throw new NotFoundException(`no quotation connects ${from} and ${to}`);
    return {
      from,
      to,
      type: wantedType ?? null,
      baseCurrency,
      rate: Number(resolution.rate.toFixed(6)),
      ...(resolution.buy !== undefined
        ? { buy: Number(resolution.buy.toFixed(4)), sell: Number((resolution.sell ?? 0).toFixed(4)) }
        : {}),
      kind: resolution.kind,
      used: resolution.used,
    };
  }

  /** The currency equivalences are expressed in; the catalog decides what is valid. */
  baseCurrency(): CurrencyCode {
    const stored = this.settings.get(BASE_CURRENCY_KEY);
    return isCurrencyCode(stored) ? stored : DEFAULT_BASE_CURRENCY;
  }

  async setBaseCurrency(value: unknown): Promise<{ baseCurrency: CurrencyCode }> {
    if (!isCurrencyCode(value)) throw new BadRequestException('unknown currency');
    await this.settings.set(BASE_CURRENCY_KEY, value);
    return { baseCurrency: value };
  }

  /**
   * The daily cross-check (spec 030) watches every feed worth watching and warns per feed, with its
   * name and its last date: a source that goes silent has to be visible by itself instead of hiding
   * behind the other one.
   */
  async dailyCrossCheck(): Promise<void> {
    for (const feed of WATCHED_FEEDS) {
      const lastDate = await this.ratesRepo.getLastDate(feed.type, feed.base, feed.quote);
      const warning = staleFeedWarning(feed, lastDate);
      if (warning) this.log.warn(warning);
    }
  }

  /**
   * Called by the scheduler every hour.
   * Triggers a full reconcile if >6h have passed since last one (gap-fill).
   * Daily cross-check runs if >24h since last reconcile.
   */
  async hourlyTick(): Promise<void> {
    const elapsed = (Date.now() - this.lastReconcileAt) / 3600_000;
    if (elapsed > 6 || this.lastReconcileAt === 0) {
      this.log.log(`Hourly tick: ${Math.round(elapsed)}h since last reconcile, triggering full sync`);
      await this.reconcileFull();
    }
    if (elapsed > 24) {
      await this.dailyCrossCheck();
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
