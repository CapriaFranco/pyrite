import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { ratesDaily } from '../../../drizzle/schema';

@Injectable()
export class RatesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async upsertMany(
    rows: Array<{ type: string; base: string; quote: string; buy: number; sell: number; date: string }>,
  ): Promise<void> {
    for (const row of rows) {
      await this.db
        .insert(ratesDaily)
        .values({
          type: row.type,
          base: row.base,
          quote: row.quote,
          buy: String(row.buy),
          sell: String(row.sell),
          date: row.date,
        })
        .onConflictDoNothing({ target: [ratesDaily.type, ratesDaily.base, ratesDaily.quote, ratesDaily.date] });
    }
  }

  async getLatest(
    type: string,
    base?: string,
    quote?: string,
  ): Promise<{ base: string; quote: string; buy: number; sell: number; date: string } | undefined> {
    const conditions = [eq(ratesDaily.type, type)];
    if (base) conditions.push(eq(ratesDaily.base, base));
    if (quote) conditions.push(eq(ratesDaily.quote, quote));
    const rows = await this.db
      .select()
      .from(ratesDaily)
      .where(and(...conditions))
      .orderBy(sql`${ratesDaily.date} DESC`)
      .limit(1);
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return { base: row.base, quote: row.quote, buy: Number(row.buy), sell: Number(row.sell), date: row.date };
  }

  async getSeries(
    type: string,
    from?: string,
    to?: string,
    base?: string,
    quote?: string,
  ): Promise<Array<{ base: string; quote: string; buy: number; sell: number; date: string }>> {
    const conditions = [eq(ratesDaily.type, type)];
    if (base) conditions.push(eq(ratesDaily.base, base));
    if (quote) conditions.push(eq(ratesDaily.quote, quote));
    if (from) conditions.push(sql`${ratesDaily.date} >= ${from}`);
    if (to) conditions.push(sql`${ratesDaily.date} <= ${to}`);
    const rows = await this.db
      .select()
      .from(ratesDaily)
      .where(and(...conditions))
      .orderBy(ratesDaily.date);
    return rows.map((row) => ({
      base: row.base,
      quote: row.quote,
      buy: Number(row.buy),
      sell: Number(row.sell),
      date: row.date,
    }));
  }

  async getLastDate(type: string): Promise<string | undefined> {
    const result = await this.db.execute(sql`SELECT date FROM rates_daily WHERE type = ${type} ORDER BY date DESC LIMIT 1`);
    const rows = result.rows as unknown as Array<{ date: string }>;
    return rows[0]?.date;
  }

  /**
   * The newest point of every (type, pair), which is what resolving a rate needs (spec 027): the
   * utility picks the pair it wants and never asks the database per candidate.
   */
  async findLatestPoints(): Promise<
    Array<{ type: string; base: string; quote: string; buy: number; sell: number; date: string }>
  > {
    const rows = await this.db
      .selectDistinctOn([ratesDaily.type, ratesDaily.base, ratesDaily.quote], {
        type: ratesDaily.type,
        base: ratesDaily.base,
        quote: ratesDaily.quote,
        buy: ratesDaily.buy,
        sell: ratesDaily.sell,
        date: ratesDaily.date,
      })
      .from(ratesDaily)
      .orderBy(ratesDaily.type, ratesDaily.base, ratesDaily.quote, sql`${ratesDaily.date} DESC`);
    return rows.map((row) => ({
      type: row.type,
      base: row.base,
      quote: row.quote,
      buy: Number(row.buy),
      sell: Number(row.sell),
      date: row.date,
    }));
  }
}
