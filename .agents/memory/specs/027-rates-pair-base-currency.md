# 027 Rates pair and base currency

## Objective

A saved rate has a price but no pair: `type` is the name of the quotation (blue, oficial, bolsa...)
and "against the peso" is implicit, so an EUR/USD or an EUR/ARS cannot even be written down. This
spec makes the pair explicit and adds the system base currency, with the piece that was missing to
use them: one utility that resolves the rate of a pair, whether it exists directly, only inverted, or
only through the base currency.

## Current state (pre-check before this spec)

- `rates_daily`: `type` (text), `buy`, `sell`, `date`, unique on `(type, date)`. Seven types exist
  and all of them are dollar quotations against the peso: blue, bolsa, contadoconliqui, cripto,
  mayorista, oficial, tarjeta.
- `RatesService`: full reconcile from ArgentinaDatos (the dollar houses), intraday refresh, and
  `getLatest` / `getSeries` by `type`.
- Finances does **not** read rates: the conversion of a movement is an immutable snapshot
  (`paid_amount / amount`, spec 005).
- The catalog of currencies is already there (spec 026), so a pair can point at real codes.

## Scope

- In scope: `base` and `quote` on `rates_daily` with the migration of the existing rows; the base
  currency as a setting; the pure utility that resolves a pair (direct, inverse or through the base
  currency); the endpoints to convert and to read or change the base currency.
- Out of scope: new quotation providers (there is no euro source integrated yet); making finances
  compute its snapshot with this utility (the snapshot of a movement stays what it was); assets
  (#36); the UI (#9).

## Approach

### The pair is explicit

`rates_daily` gains `base` and `quote`, both text referencing the currency catalog, and its unique
key becomes `(type, base, quote, date)`: the same `type` on the same day can then describe two
different pairs, which is exactly what a euro quotation needs. `type` keeps being the name of the
quotation.

The migration sets every existing row to `USD` / `ARS`, because that is what all seven types are,
and keeps their `buy`, `sell` and `date` untouched.

### The base currency

The setting `finances.base_currency` (default `ARS`) is the currency the system expresses
equivalences in. It is validated against the catalog: a code outside it is a 400, never a silent
fallback.

### Resolving a pair

A pure function, in `bll/rates/rate-pair.ts`, with no Nest and no database:

- `resolveRate({ series, from, to, type })` answers with `buy`, `sell` and how it got there:
  - **direct**: a series with `base = from, quote = to`;
  - **inverse**: only the opposite pair exists, so the rate is inverted (`1 / sell`, `1 / buy`);
  - **cross**: no direct or inverse pair, but `from -> baseCurrency` and `baseCurrency -> to` do
    exist, so the two multiply;
  - `null` when there is no path at all - the caller decides what to do, the utility never invents a
    rate.
- When several series share a pair (blue and oficial both being USD/ARS), the requested `type` picks
  one; without one, the caller passes what it wants and the utility does not guess.

### Service and endpoints

- `GET /rates/convert?from=&to=&type=` answers the resolved rate and its kind, or a 404 when the
  pair cannot be reached.
- `GET /rates/base-currency` and `POST /rates/base-currency` read and set the base, validated
  against the catalog.
- The existing `latest` and `series` endpoints gain the optional `base` and `quote` filters, and keep
  working without them.

## Acceptance criteria

- [ ] `rates_daily` has `base` and `quote` referencing the catalog, and every existing row keeps its
      `buy`, `sell` and `date` with the pair `USD`/`ARS`.
- [ ] Two quotations with the same `type` and date but different pairs coexist.
- [ ] The base currency is a validated setting: an unknown code is a 400.
- [ ] The utility resolves a direct pair, an inverse pair, and a pair that only exists through the
      base currency, and answers nothing when there is no path.
- [ ] The conversion endpoint answers the rate with the kind of resolution it used, and 404 when the
      pair cannot be reached.
- [ ] The sync keeps working and writes the pair explicitly.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- Pure assertions on the utility: direct, inverse, cross through the base currency, no path, and
  choosing one type among several for the same pair.
- Migration: rows counted and values compared before and after, per type.
- Smoke: converting USD to ARS with a real quotation and ARS to USD through the inverse, plus the
  base-currency setting round trip and its 400.
- Full battery: the five assertion suites and the eleven previous smokes.

Result and measurements: `docs/records/027-rates-pair-base-currency.md`.
