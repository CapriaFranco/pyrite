import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb, type DrizzleTx } from '../drizzle.provider';
import { movements, categories, platforms, balances, currencies } from '../../../drizzle/schema';

export type MovementRow = typeof movements.$inferSelect;
export type MovementInsert = typeof movements.$inferInsert;
export type CategoryRow = typeof categories.$inferSelect;

/**
 * A movement row of a batch: the id is written by the service, so the answer can keep the order of
 * the request even though the insert is one statement (spec 029).
 */
export type BatchMovementRow = MovementInsert & { id: string };

/** One balance and the net movement of a whole batch on it, already aggregated and sorted. */
export interface BalanceDelta {
  currencyCode: string;
  walletType: string;
  delta: number;
}

/**
 * DAL for the finances domain. Only layer that touches these tables.
 * The BLL computes balance logic; this repository just persists/reads rows.
 */
@Injectable()
export class FinancesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  // ======== movements ========

  async createMovement(row: typeof movements.$inferInsert): Promise<typeof movements.$inferSelect> {
    const inserted = await this.db.insert(movements).values(row).returning();
    return inserted[0];
  }

  /**
   * The write of a whole batch as one unit (spec 029): the rows and the balance increments land
   * together or not at all, which is what a session of separate requests cannot give. The deltas
   * arrive aggregated and sorted by the service, so two concurrent batches take the row locks in
   * the same order. The answer keeps the order of the request: the ids are the ones the service
   * wrote, which is what lets the gateway pair each item with its own row.
   */
  async insertMovementsWithBalances(rows: BatchMovementRow[], deltas: BalanceDelta[]): Promise<MovementRow[]> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx.insert(movements).values(rows).returning();
      for (const delta of deltas) {
        await this.applyIncrement(tx, delta.currencyCode, delta.walletType, delta.delta);
      }

      const saved = new Map(inserted.map((row) => [row.id, row]));
      return rows.map((row) => {
        const movement = saved.get(row.id);
        // An insert that does not answer a row it just wrote is not something to hide: the
        // transaction rolls back and nothing is committed.
        if (!movement) throw new Error(`inserted movement ${row.id} missing from the answer`);
        return movement;
      });
    });
  }

  async findMovements(): Promise<Array<typeof movements.$inferSelect>> {
    return this.db.select().from(movements).where(eq(movements.status, 'active')).orderBy(movements.date);
  }

  async findMovement(id: string): Promise<typeof movements.$inferSelect | undefined> {
    const rows = await this.db.select().from(movements).where(eq(movements.id, id)).limit(1);
    return rows[0];
  }

  async softDeleteMovement(id: string): Promise<void> {
    await this.db.update(movements).set({ status: 'deleted' }).where(eq(movements.id, id));
  }

  // ======== categories ========

  async createCategory(
    name: string,
    type: 'income' | 'expense',
    isService = false,
  ): Promise<typeof categories.$inferSelect> {
    const inserted = await this.db.insert(categories).values({ name, type, isService }).returning();
    return inserted[0];
  }

  async findCategory(id: string): Promise<typeof categories.$inferSelect | undefined> {
    const rows = await this.db.select().from(categories).where(eq(categories.id, id)).limit(1);
    return rows[0];
  }

  /** Marks (or unmarks) a category as the place where services and subscriptions land. */
  async setCategoryService(id: string, isService: boolean): Promise<typeof categories.$inferSelect | undefined> {
    const rows = await this.db
      .update(categories)
      .set({ isService })
      .where(eq(categories.id, id))
      .returning();
    return rows[0];
  }

  async findCategories(): Promise<Array<typeof categories.$inferSelect>> {
    return this.db.select().from(categories).where(eq(categories.status, 'active'));
  }

  /**
   * The categories of a batch in one query (spec 029): those that exist and are active, so the
   * service can tell which item names one that does not without a query per item.
   */
  async findActiveCategoriesByIds(ids: string[]): Promise<CategoryRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(categories)
      .where(and(inArray(categories.id, ids), eq(categories.status, 'active')));
  }

  // ======== platforms ========

  async createPlatform(name: string): Promise<typeof platforms.$inferSelect> {
    const inserted = await this.db.insert(platforms).values({ name }).returning();
    return inserted[0];
  }

  async findPlatforms(): Promise<Array<typeof platforms.$inferSelect>> {
    return this.db.select().from(platforms).where(eq(platforms.status, 'active'));
  }

  // ======== currencies ========

  /** The currency catalog, in display order (spec 026). Read-only: it is system data. */
  async findCurrencies(): Promise<Array<typeof currencies.$inferSelect>> {
    return this.db.select().from(currencies).orderBy(currencies.position);
  }

  // ======== balances ========

  /** Every balance row: the pivot of currency and flow. */
  async findBalances(): Promise<Array<typeof balances.$inferSelect>> {
    return this.db.select().from(balances);
  }

  async getBalance(currencyCode: string, walletType: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(balances)
      .where(and(eq(balances.currencyCode, currencyCode), eq(balances.walletType, walletType as never)))
      .limit(1);
    return rows.length ? Number(rows[0].amount) : 0;
  }

  async setBalance(currencyCode: string, walletType: string, amount: number): Promise<void> {
    await this.db
      .insert(balances)
      .values({ currencyCode, walletType: walletType as never, amount: String(amount) })
      .onConflictDoUpdate({
        target: [balances.currencyCode, balances.walletType],
        set: { amount: String(amount), updatedAt: new Date() },
      });
  }

  /**
   * Moves a balance by a delta with the arithmetic done in SQL (spec 025). The previous
   * read-modify-write lost a delta when two writes interleaved: both read the same value and the
   * second overwrote the first. Here the row is updated in one statement, so concurrent deltas add
   * up. A missing row starts at the delta itself.
   */
  async incrementBalance(currencyCode: string, walletType: string, delta: number): Promise<void> {
    await this.applyIncrement(this.db, currencyCode, walletType, delta);
  }

  /**
   * The one definition of "move a balance" (specs 025 and 029): the single path and the batch both
   * come through here, with the database handle of whoever owns the write (the connection or the
   * open transaction).
   */
  private async applyIncrement(
    db: DrizzleDb | DrizzleTx,
    currencyCode: string,
    walletType: string,
    delta: number,
  ): Promise<void> {
    await db
      .insert(balances)
      .values({ currencyCode, walletType: walletType as never, amount: String(delta) })
      .onConflictDoUpdate({
        target: [balances.currencyCode, balances.walletType],
        set: {
          amount: sql`${balances.amount} + ${String(delta)}::numeric`,
          updatedAt: new Date(),
        },
      });
  }
}