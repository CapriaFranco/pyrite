import { Injectable } from '@nestjs/common';

export interface ArgentinaDatosRow {
  casa: string;
  compra: number;
  venta: number;
  fecha: string;
}

/**
 * A row of the currency endpoint (spec 030): one per currency and day, with the source's own name
 * for the quotation. `casa` is optional because the oldest days of the euro arrive without it.
 */
export interface ArgentinaDatosCurrencyRow {
  moneda: string;
  casa?: string;
  compra: number;
  venta: number;
  fecha: string;
}

@Injectable()
export class ArgentinaDatosClient {
  /** The dollar's full series, house by house. */
  async fetchFullSeries(): Promise<ArgentinaDatosRow[]> {
    const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares');
    if (!res.ok) throw new Error(`ArgentinaDatos returned ${res.status}`);
    return res.json() as Promise<ArgentinaDatosRow[]>;
  }

  /**
   * The whole currency payload (five currencies, one row per day each); whatever is ingested from it
   * is the service's decision, not the client's.
   */
  async fetchCurrencies(): Promise<ArgentinaDatosCurrencyRow[]> {
    const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/');
    if (!res.ok) throw new Error(`ArgentinaDatos returned ${res.status}`);
    return res.json() as Promise<ArgentinaDatosCurrencyRow[]>;
  }
}