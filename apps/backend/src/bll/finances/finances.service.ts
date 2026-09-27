import { BadRequestException, Injectable } from '@nestjs/common';
import { FinancesRepository } from '../../dal/finances/finances.repository';
import { isCurrencyCode, isWalletType, type CurrencyCode, type WalletType } from '../../types/currencies';

export interface NewMovementInput {
  type: 'income' | 'expense';
  amountCurrency: CurrencyCode;
  amount: number;
  paidCurrency: CurrencyCode;
  paidAmount: number;
  /** Which balance the movement moves: the currency plus the flow (spec 026). */
  currencyCode: CurrencyCode;
  walletType: WalletType;
  categoryId: string;
  description: string;
  note?: string | null;
  /** A JSON client always sends a string; a Date is accepted for callers inside the app. */
  date?: Date | string;
  platformId?: string | null;
}

/** The balance grid: every active currency crossed with the two flows (spec 026). */
export type BalanceGrid = Record<string, Record<WalletType, number>>;

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
   */
  async createMovement(input: NewMovementInput, rateUsed?: number): Promise<unknown> {
    this.requireBalanceTarget(input.currencyCode, input.walletType);
    const rate = rateUsed ?? (input.paidAmount / input.amount);
    const movement = await this.repo.createMovement({
      type: input.type,
      amountCurrency: input.amountCurrency,
      amount: String(input.amount),
      paidCurrency: input.paidCurrency,
      paidAmount: String(input.paidAmount),
      rateUsed: String(rate),
      currencyCode: input.currencyCode,
      walletType: input.walletType,
      categoryId: input.categoryId,
      description: input.description,
      note: input.note ?? null,
      date: this.movementDate(input.date),
      platformId: input.platformId ?? null,
    });

    // paidAmount is the real amount in the balance's currency.
    const delta = input.type === 'income' ? input.paidAmount : -input.paidAmount;
    await this.repo.incrementBalance(input.currencyCode, input.walletType, delta);

    return movement;
  }

  async listMovements() {
    return this.repo.findMovements();
  }

  /**
   * The date of a movement is optional (now by default) but must be a real moment: a JSON
   * client sends a string and a malformed one used to reach the driver, which answered a 500.
   */
  private movementDate(value: Date | string | undefined): Date {
    if (value === undefined) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('invalid date');
    return date;
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

  /** A currency comes from the system catalog and the flow from the two that exist. */
  private requireBalanceTarget(currencyCode: unknown, walletType: unknown): void {
    if (!isCurrencyCode(currencyCode)) throw new BadRequestException('unknown currency');
    if (!isWalletType(walletType)) throw new BadRequestException('walletType must be cash or digital');
  }
}