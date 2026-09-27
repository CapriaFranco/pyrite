import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB, type DrizzleDb } from '../drizzle.provider';
import { movements, categories, platforms, balances, currencies } from '../../../drizzle/schema';

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
    await this.db
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