/**
 * What a movement input is (spec 029): one source of truth for the single path and for the batch,
 * so "a movement" means the same in both and there is one place to change it.
 *
 * Pure by design: no Nest, no database, no clock other than the default date. It answers the
 * validated item or the reason it is not one, and the caller decides how to answer: the service
 * turns a reason into a 400 and the batch attaches the index of the offending item.
 *
 * The order of the checks is deliberate. The balance currency and the flow go first, in the order
 * the old `requireBalanceTarget` used, so the answers of the single path do not change.
 */

import { isUuid } from '../../types/guards';
import { isCurrencyCode, isWalletType, type CurrencyCode, type WalletType } from '../../types/currencies';

/**
 * The cap of one batch: the feature is "several movements in one operation", so 50 is far above the
 * practical case, keeps the transaction short (at most 50 inserts plus one increment per pair of the
 * catalog) and is a hard cap, so the endpoint cannot be used to flood the table. It is never a
 * silent truncation: going over answers a 400 (spec 029).
 */
export const MAX_MOVEMENT_BATCH = 50;

/** The item as the client sends it. What arrives at runtime is checked, not assumed. */
export interface MovementInput {
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
  /** The rate the caller measured; when absent it is computed as paidAmount / amount. */
  rateUsed?: number | null;
}

/** The same item with every value ready for the layers below: nothing left to check or convert. */
export interface ValidatedMovement {
  type: 'income' | 'expense';
  amountCurrency: CurrencyCode;
  amount: number;
  paidCurrency: CurrencyCode;
  paidAmount: number;
  currencyCode: CurrencyCode;
  walletType: WalletType;
  categoryId: string;
  description: string;
  note: string | null;
  date: Date;
  platformId: string | null;
  /** null means "compute it": paidAmount / amount, the snapshot of the single path. */
  rateUsed: number | null;
}

export type MovementInputResult = { ok: true; item: ValidatedMovement } | { ok: false; reason: string };

export function validateMovementInput(value: unknown): MovementInputResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('movement must be an object');
  }
  const input = value as Record<string, unknown>;

  if (!isCurrencyCode(input.currencyCode)) return fail('unknown currency');
  if (!isWalletType(input.walletType)) return fail('walletType must be cash or digital');
  if (input.type !== 'income' && input.type !== 'expense') return fail('type must be income or expense');
  if (!isCurrencyCode(input.amountCurrency)) return fail('unknown currency');
  if (!isCurrencyCode(input.paidCurrency)) return fail('unknown currency');

  const amount = toNumber(input.amount);
  // Greater than zero on purpose: the rate snapshot is paidAmount / amount, so zero has no rate.
  if (amount === null || amount <= 0) return fail('amount must be a number greater than zero');
  const paidAmount = toNumber(input.paidAmount);
  if (paidAmount === null) return fail('paidAmount must be a number');

  const rateUsed = input.rateUsed === undefined || input.rateUsed === null ? null : toNumber(input.rateUsed);
  if (rateUsed !== null && rateUsed <= 0) return fail('rateUsed must be a number greater than zero');

  // The shape is checked here and the existence with one query in the service: a foreign key that
  // fails after the row was sent arrives as a 500 from the driver, which is what this avoids.
  if (typeof input.categoryId !== 'string' || !isUuid(input.categoryId)) return fail('invalid categoryId');

  const description = typeof input.description === 'string' ? input.description : null;
  if (description === null || description.trim() === '') return fail('description is required');

  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') {
    return fail('invalid note');
  }
  if (input.platformId !== undefined && input.platformId !== null) {
    if (typeof input.platformId !== 'string' || !isUuid(input.platformId)) return fail('invalid platformId');
  }

  const date = movementDate(input.date);
  if (date === null) return fail('invalid date');

  return {
    ok: true,
    item: {
      type: input.type,
      amountCurrency: input.amountCurrency,
      amount,
      paidCurrency: input.paidCurrency,
      paidAmount,
      currencyCode: input.currencyCode,
      walletType: input.walletType,
      categoryId: input.categoryId,
      // The description is stored as it was sent: it is only checked not to be empty.
      description,
      note: (input.note as string | null | undefined) ?? null,
      date,
      platformId: (input.platformId as string | null | undefined) ?? null,
      rateUsed,
    },
  };
}

function fail(reason: string): MovementInputResult {
  return { ok: false, reason };
}

/**
 * A number, or a string that holds one (the shape a form sends and the single path already stored).
 * Anything else, an empty string included, is not a number.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The date is optional (now by default) but it has to be a real moment: a malformed one used to
 * reach the driver, which answered a 500. null means it does not parse.
 */
function movementDate(value: unknown): Date | null {
  if (value === undefined || value === null) return new Date();
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
