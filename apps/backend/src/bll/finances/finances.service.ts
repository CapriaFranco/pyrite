import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  FinancesRepository,
  type BalanceDelta,
  type BatchMovementRow,
  type MovementInsert,
  type MovementRow,
} from '../../dal/finances/finances.repository';
import { MAX_MOVEMENT_BATCH, validateMovementInput, type MovementInput, type ValidatedMovement } from './movement-input';
import { isCurrencyCode, isWalletType, type WalletType } from '../../types/currencies';

/** The balance grid: every active currency crossed with the two flows (spec 026). */
export type BalanceGrid = Record<string, Record<WalletType, number>>;

/** What one movement does to its balance: the real amount, with the sign of its flow. */
function deltaOf(item: ValidatedMovement): number {
  return item.type === 'income' ? item.paidAmount : -item.paidAmount;
}

/**
 * The balance column keeps two decimals: the net of a batch is compared at that scale, so a batch
 * whose items cancel out writes nothing instead of touching a pair with a floating point rest.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class FinancesService {
  constructor(private readonly repo: FinancesRepository) {}

  /**
   * Create a movement. If rate is not provided, compute the effective rate
   * as paidAmount/amount (immutable snapshot).
   *
   * The balance moves with an atomic increment (spec 025): the arithmetic happens in SQL, so two
   * concurrent saves cannot read the same value and overwrite each other. The dispute engine gets
   * a look at what was just saved from the gateway, not from here: finances does not know about it.
   *
   * The item is checked by `movement-input` (spec 029), the same module the batch uses, so a
   * category that does not exist and an amount that has no rate answer a 400 here too instead of
   * coming back from the driver as a 500.
   */
  async createMovement(input: MovementInput, rateUsed?: number | null): Promise<unknown> {
    const item = this.validated({ ...input, rateUsed });
    const unknownCategory = await this.firstUnknownCategory([item.categoryId]);
    if (unknownCategory >= 0) throw new BadRequestException('category not found');

    const movement = await this.repo.createMovement(this.movementRow(item));
    await this.repo.incrementBalance(item.currencyCode, item.walletType, deltaOf(item));
    return movement;
  }

  /**
   * Several movements as one unit (spec 029). The whole list is validated before the transaction
   * opens, on purpose: a rollback alone would give atomicity but the only error left to answer
   * would be a driver error mapped back to a position in the payload. The categories are resolved
   * in one query and the balance deltas are aggregated per currency and flow, so the three items of
   * a session that touch the same pair are one increment. The rows and the increments land together
   * or not at all, and the answer keeps the order of the request.
   */
  async createMovementBatch(inputs: unknown): Promise<MovementRow[]> {
    const items = this.validatedBatch(inputs);
    const unknownCategory = await this.firstUnknownCategory(items.map((item) => item.categoryId));
    if (unknownCategory >= 0) throw this.invalidItem(unknownCategory, 'category not found');

    return this.repo.insertMovementsWithBalances(
      items.map((item) => this.batchRow(item)),
      this.balanceDeltas(items),
    );
  }

  async listMovements() {
    return this.repo.findMovements();
  }

  async softDeleteMovement(id: string): Promise<void> {
    const m = await this.repo.findMovement(id);
    if (!m) throw new Error('movement not found');
    // Restore the balance (opposite of what the movement did), atomically and only once.
    if (m.status !== 'deleted') {
      const delta = m.type === 'income' ? -Number(m.paidAmount) : Number(m.paidAmount);
      await this.repo.incrementBalance(m.currencyCode, m.walletType, delta);
    }
    await this.repo.softDeleteMovement(id);
  }

  async createCategory(name: string, type: 'income' | 'expense', isService = false): Promise<unknown> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('category name is required');
    return this.repo.createCategory(trimmed, type, isService === true);
  }

  /** Marks the category where services and subscriptions land: what turns the intake on. */
  async setCategoryService(id: string, isService: unknown): Promise<unknown> {
    const category = await this.repo.findCategory(id);
    if (!category) throw new BadRequestException('category not found');
    if (typeof isService !== 'boolean') throw new BadRequestException('isService must be a boolean');
    return this.repo.setCategoryService(id, isService);
  }

  async listCategories() {
    return this.repo.findCategories();
  }

  async createPlatform(name: string) {
    return this.repo.createPlatform(name);
  }

  async listPlatforms() {
    return this.repo.findPlatforms();
  }

  /**
   * The balance grid (spec 026): every currency of the catalog crossed with the two flows, with the
   * stored amount or zero. Nothing here is hardcoded, so adding a currency adds a column by itself.
   */
  async getBalances(): Promise<BalanceGrid> {
    const [catalog, rows] = await Promise.all([this.repo.findCurrencies(), this.repo.findBalances()]);
    const stored = new Map(rows.map((row) => [`${row.currencyCode}:${row.walletType}`, Number(row.amount)]));
    const grid: BalanceGrid = {};
    for (const currency of catalog) {
      if (!currency.isActive) continue;
      grid[currency.code] = {
        cash: stored.get(`${currency.code}:cash`) ?? 0,
        digital: stored.get(`${currency.code}:digital`) ?? 0,
      };
    }
    return grid;
  }

  /** The catalog as the front reads it: code, name, symbol, decimals, order. */
  async listCurrencies() {
    const rows = await this.repo.findCurrencies();
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      isActive: row.isActive,
      position: row.position,
    }));
  }

  /**
   * The manual override: the user writes the number they just counted. A currency outside the
   * system catalog or a flow that does not exist is a 400, never a row created by accident.
   */
  async setBalance(currencyCode: unknown, walletType: unknown, amount: unknown) {
    if (!isCurrencyCode(currencyCode)) throw new BadRequestException('unknown currency');
    if (!isWalletType(walletType)) throw new BadRequestException('walletType must be cash or digital');
    const parsed = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(parsed)) throw new BadRequestException('amount must be a number');
    await this.repo.setBalance(currencyCode, walletType, parsed);
    return this.getBalances();
  }

  // ============ INTERNALS ============

  /** One item, from the raw body to the validated shape: a reason becomes a 400 with that text. */
  private validated(value: unknown): ValidatedMovement {
    const result = validateMovementInput(value);
    if (!result.ok) throw new BadRequestException(result.reason);
    return result.item;
  }

  /**
   * The whole list in order: the first item that is not a movement stops the batch before anything
   * is written, and its zero-based position travels with the answer so a client can point at the
   * line it sent. The cap is enforced here, never as a silent truncation.
   */
  private validatedBatch(inputs: unknown): ValidatedMovement[] {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new BadRequestException('movements must be a non-empty array');
    }
    if (inputs.length > MAX_MOVEMENT_BATCH) {
      throw new BadRequestException(`a batch holds at most ${MAX_MOVEMENT_BATCH} movements`);
    }
    return inputs.map((value, index) => {
      const result = validateMovementInput(value);
      if (!result.ok) throw this.invalidItem(index, result.reason);
      return result.item;
    });
  }

  /** The answer of an invalid item: the reason and the position, in the shape Nest already uses. */
  private invalidItem(index: number, reason: string): BadRequestException {
    return new BadRequestException({ message: reason, error: 'Bad Request', statusCode: 400, index });
  }

  /**
   * The position of the first item that names a category that does not exist or is not active.
   * One query for the whole list, and one code path for the single save and the batch: this is what
   * turns a foreign key failure, a 500 from the driver, into a 400 that names the item.
   */
  private async firstUnknownCategory(ids: string[]): Promise<number> {
    const rows = await this.repo.findActiveCategoriesByIds([...new Set(ids)]);
    const known = new Set(rows.map((row) => row.id));
    return ids.findIndex((id) => !known.has(id));
  }

  /** The row of one validated item: the same columns the single path writes, and no others. */
  private movementRow(item: ValidatedMovement): MovementInsert {
    return {
      type: item.type,
      amountCurrency: item.amountCurrency,
      amount: String(item.amount),
      paidCurrency: item.paidCurrency,
      paidAmount: String(item.paidAmount),
      rateUsed: String(item.rateUsed ?? item.paidAmount / item.amount),
      currencyCode: item.currencyCode,
      walletType: item.walletType,
      categoryId: item.categoryId,
      description: item.description,
      note: item.note,
      date: item.date,
      platformId: item.platformId,
    };
  }

  /**
   * The row of a batch item, with its id written here: the insert is one statement, and a known id
   * is what lets the repository answer in the order of the request. No schema change: it is the
   * same column the database fills on its own for a single save.
   */
  private batchRow(item: ValidatedMovement): BatchMovementRow {
    return { ...this.movementRow(item), id: randomUUID() };
  }

  /**
   * One delta per currency and flow, the net of the whole batch: three items on the same pair are
   * one increment, and a pair whose deltas cancel out writes nothing (the grid answers 0 for a pair
   * with no row, so the observable balance is the same). Sorted by currency and then by flow, so
   * two concurrent batches take the row locks in the same order and cannot deadlock.
   */
  private balanceDeltas(items: ValidatedMovement[]): BalanceDelta[] {
    const totals = new Map<string, BalanceDelta>();
    for (const item of items) {
      const key = `${item.currencyCode}:${item.walletType}`;
      const sum = (totals.get(key)?.delta ?? 0) + deltaOf(item);
      totals.set(key, { currencyCode: item.currencyCode, walletType: item.walletType, delta: sum });
    }
    return [...totals.values()]
      .map((total) => ({ ...total, delta: round2(total.delta) }))
      .filter((total) => total.delta !== 0)
      .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode) || a.walletType.localeCompare(b.walletType));
  }
}