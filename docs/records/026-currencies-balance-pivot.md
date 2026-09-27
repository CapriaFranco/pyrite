# 026 Currencies and balance pivot - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **The migration ran without a single error** and the data survived, measured with SQL before and
  after on `pyrite_test` (the database that actually had data):
  - the two balances kept their exact amounts: `ARS/digital -9600.00` and `USD/digital -470433.00`
    (the four rows of the old enum shape became their pairs);
  - the **350 movements** stayed 350, all with a currency and a flow (66 ARS + 284 USD, all digital);
  - the **368 payment tasks** kept their currency (110 ARS + 258 USD);
  - the catalog ended with the three seeded currencies (ARS, USD, EUR) and the `wallet_type` enum
    with its two values.
  On `pyrite` (dev, no data) the four rows translated to their pairs at 0.00.
- **The SQL was proved beforehand**: the whole file was run inside a transaction and rolled back, so
  syntax and logic were validated without touching anything.
- **12 HTTP checks** (`smoke-026-currencies.mjs`): the catalog with its detail and order, the balance
  grid with the three currencies and no extra keys, a movement in **EUR cash** and another in
  **USD digital**, each moving only its own pair (the other flow of the same currency and the other
  currencies untouched), and the movement keeping the pair it was created with.
- No regressions: the five assertion suites (34 + 22 + 31 + 19 + 44) and the ten previous smokes
  stayed green, with the finances payloads updated to `currencyCode` + `walletType`.

## Decisions taken while building

- **The catalog is system data**: seeded by the migration, no endpoint writes it. `isActive` exists
  to keep a currency out of the lists without deleting it.
- **The valid codes are a system constant** (`types/currencies.ts`), and the table is its persistent
  side. That keeps boundary validation synchronous (an unknown code is a 400) with a single source
  of truth, instead of a database read in every validator.
- **`currencyEnum` was deleted**: the currency is a catalog code in `movements`, `task_payments`,
  `task_price_tiers` and `task_expectations`. Leaving the enum alive for tasks would have been two
  representations of the same thing, which the repo forbids.
- **The flow axis has exactly two values** (`cash`, `digital`): how the money moves, physical or
  digital. It is not expected to grow.
- **Assets are a different model, not a currency**: shares, crypto and metals (gold) are quantity
  plus valuation with their own trackers, registered as #36.

## The migration, in plain language

Order: create, convert, then remove. `balances` was rebuilt as a pivot and filled from the old table
before the old one was dropped; `movements.balance_source` was copied into `currency_code` +
`wallet_type` before the column was dropped; the five currency columns changed from enum to text
keeping their values; and only then `balance_key` and `currency` were dropped. Three separate
confirmations were requested before applying it, as the `pyrite-orm` skill requires for a migration
that drops data.

## Not verified

Live browser flow: the screen that shows the grid is UI (#9). The rates pair and the base currency
are spec 027, still open.
