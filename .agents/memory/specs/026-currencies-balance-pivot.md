# 026 Currencies and balance pivot

## Objective

The economy today keeps two different ideas inside one enum: `balance_key` is
`cash_ars | digital_ars | cash_usd | digital_usd`. But the currency and the flow (physical or
digital) are two separate axes: the currency belongs in its own catalog at system level (today
peso, dollar and euro, with room for others) and the flow has exactly two values that never grow
(`cash`, `digital`). This spec separates the axes, migrates the existing data and leaves the domain
ready to add a currency as a row instead of a migration.

## Current state (pre-check before this spec)

- `balanceKeyEnum`: four keys that mix currency and flow; `balances` uses it as its primary key.
- `movements.amountCurrency` and `paidCurrency`: `currencyEnum` (`ARS | USD`);
  `movements.balanceSource`: the four-key enum.
- `FinancesService.getBalances()` has the four keys **hardcoded**.
- Balance arithmetic is a delta applied in one statement (spec 025); the previous spec (005) defined
  the delta model and `rateUsed` as the immutable conversion snapshot.

## Scope

- In scope: the `currencies` catalog (system level, seeded), the `wallet_type` enum, `balances` as a
  pivot, `movements` pointing at currency + flow, the data migration, `getBalances` without
  hardcoded keys, read endpoints for the catalog, and **the currency as a single concept across the
  backend**: `task_payments.currency` moves to the catalog too and `currencyEnum` disappears, because
  leaving the enum alive for tasks while finances uses the catalog would be two representations of
  the same thing (which the repo forbids).
- Out of scope: rates with base/quote and the base-currency setting (027); assets like shares, crypto
  or gold, which are quantity plus valuation and have their own mechanics (#36); the UI (#9).

## The cut, after this decision

The multi-currency front is covered by **two** specs:

- **026** (this one): currencies, the two axes, the migration, and the currency as the single concept
  the whole backend shares.
- **027**: rates with base/quote, the base-currency setting, and picking the right rate for a pair.


## Approach

### The catalog

`currencies`: `code` (text, primary key), `name`, `symbol`, `decimals`, `isActive`, `position`.
Seeded by the migration with the three that exist today: ARS (Peso argentino, $, 2), USD (Dolar,
US$, 2) and EUR (Euro, 2). **No write endpoint**: the catalog is part of the system, not user data.
`isActive` exists so a currency can be kept out of the lists without deleting it, changed by
migration when needed.

### The pivot

`wallet_type` as an enum with exactly two values: `cash` (physical) and `digital`. Nothing else is
expected on this axis.

`balances` becomes a pivot with a composite primary key `(currency_code, wallet_type)`, with
`currency_code` referencing the catalog. The two axes are explicit and the currency is data.

### Movements and payments

- `balance_source` (four-key enum) is replaced by `currency_code` (text, referencing the catalog)
  plus `wallet_type`.
- `amount_currency` and `paid_currency` (enums) become text referencing the catalog.
- `task_payments.currency` (the enum) does the same: the price of a payment is any catalog currency.
- `currencyEnum` is deleted: after this, a currency is a code from the catalog everywhere.

Every change lands here in one pass so each table is migrated once.

### One list of valid codes

The catalog is part of the system, so **the valid codes are a system constant** (the same list the
migration seeds) and `currencies` is its persistent side: names, symbols, decimals, order and
`isActive`. That keeps boundary validation synchronous (a currency outside the list is a 400) with a
single source of truth, instead of turning every validator into a database read.


### Data migration

Additive first, then converted, then cleaned, in that order:

1. create `currencies`, seed it, create `wallet_type` and the new columns;
2. copy the data: `cash_ars -> ARS/cash`, `digital_ars -> ARS/digital`, `cash_usd -> USD/cash`,
   `digital_usd -> USD/digital`;
3. only then drop the old columns and the old enums.

The `.sql` is read in full and shown before it is applied, and the migration is applied only with
the user's explicit confirmation for it (the protocol of the `pyrite-orm` skill, as in 011 and 018).

### Service

`getBalances()` stops carrying keys in code: it reads the pivot and answers the full grid of active
currencies crossed with the two flows, with zero where there is no row yet, so the front always
receives the same shape. The endpoints of the catalog are read-only.

## Acceptance criteria

- [ ] The catalog holds ARS, USD and EUR with name, symbol and decimals, and no endpoint can modify
      it.
- [ ] `currencyEnum` no longer exists: no table keeps a currency as an enum.
- [ ] The four existing balances keep their exact amount after the migration (ARS/cash, ARS/digital,
      USD/cash, USD/digital).
- [ ] A movement created in EUR moves the EUR balance of the flow it names and touches no other.
- [ ] A payment task whose price is in EUR is accepted, and its currency survives a round trip.
- [ ] Movements and payments saved before the migration keep their currency and their translated
      flow.
- [ ] `getBalances` has no currency or flow hardcoded.
- [ ] A movement or a payment naming a currency outside the catalog is rejected with 400.
- [ ] The existing smokes stay green with their payloads updated to the new shape.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- Migration: the four balance amounts are measured with SQL before and after, and compared (same
  method as spec 018).
- New smoke (`026-currencies-balance-pivot`): a movement in EUR cash and another in USD digital, with
  the balances checked per pair, the catalog read through its endpoint, and a payment task priced in
  EUR.
- Full battery: the five assertion suites and the ten previous smokes, with the finances and tasks
  payloads updated.

Result and measurements: `docs/records/026-currencies-balance-pivot.md`.
