/**
 * The two axes of the economy (spec 026), shared by every layer so a currency or a flow is
 * understood the same way everywhere.
 *
 * The currency catalog lives in the database because it carries detail (name, symbol, decimals,
 * order, active flag), but **the valid codes are this system constant**: the migration seeds
 * exactly these and boundary validation checks against them without a query. A currency is not user
 * data - it is part of the system.
 *
 * The flow is how the money moves: physical or digital. Two values, and nothing else is expected on
 * this axis.
 */

export const SYSTEM_CURRENCIES = ['ARS', 'USD', 'EUR'] as const;

export type CurrencyCode = (typeof SYSTEM_CURRENCIES)[number];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SYSTEM_CURRENCIES as readonly string[]).includes(value);
}

export const WALLET_TYPES = ['cash', 'digital'] as const;

export type WalletType = (typeof WALLET_TYPES)[number];

export function isWalletType(value: unknown): value is WalletType {
  return typeof value === 'string' && (WALLET_TYPES as readonly string[]).includes(value);
}
