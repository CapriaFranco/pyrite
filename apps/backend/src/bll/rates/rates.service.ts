import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ArgentinaDatosClient } from '../../integrations/argentinadatos.client';
import { DolarApiClient, type DolarApiRate } from '../../integrations/dolarapi.client';
import { RatesRepository } from '../../dal/rates/rates.repository';
import { SettingsService } from '../settings/settings.service';
import { isCurrencyCode, type CurrencyCode } from '../../types/currencies';
import { resolveRate, type RateResolution } from './rate-pair';

export interface RateEntry {
  type: string;
  /** The pair of the quotation (spec 027): both sides are codes of the currency catalog. */
  base: string;
  quote: string;
  buy: number;
  sell: number;
  date: string;
}

/** The currency equivalences are expressed in, as a setting (spec 027). */
export const BASE_CURRENCY_KEY = 'finances.base_currency';
const DEFAULT_BASE_CURRENCY: CurrencyCode = 'ARS';

/** Everything the providers give is the dollar against the peso. */
const PROVIDER_PAIR = { base: 'USD', quote: 'ARS' };

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

  async reconcileFull(): Promise<number> {
    const fromDate = process.env.RATES_SYNC_FROM ?? '2025-01-01';
    const rows = await this.argData.fetchFullSeries();
    const entries = rows
      .filter((r) => r.casa && r.venta != null && r.compra != null && r.fecha >= fromDate)
      .map((r) => ({ type: r.casa, ...PROVIDER_PAIR, buy: r.compra, sell: r.venta, date: r.fecha }));
    await this.ratesRepo.upsertMany(entries);
    this.lastReconcileAt = Date.now();
    this.log.log(`Reconcile complete: ${entries.length} entries (from ${fromDate})`);
    return entries.length;
  }

  async refreshIntradia(): Promise<void> {
    this.intradiaRates = await this.dolarApi.fetchAll();
  }

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
    const row = await this.ratesRepo.getLatest(type, base, quote);
    return row ? { ...row, type } : undefined;
  }

  async getSeries(type: string, from?: string, to?: string, base?: string, quote?: string): Promise<RateEntry[]> {
    const rows = await this.ratesRepo.getSeries(type, from, to, base, quote);
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

  async dailyCrossCheck(): Promise<void> {
    const lastBlue = await this.ratesRepo.getLastDate('blue');
    if (!lastBlue) {
      this.log.warn('Daily check: no blue data at all');
      return;
    }
    const daysBehind = (Date.now() - new Date(lastBlue).getTime()) / 86_400_000;
    if (daysBehind > 2) this.log.warn(`Daily check: blue ${Math.floor(daysBehind)} days behind (last=${lastBlue})`);
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
