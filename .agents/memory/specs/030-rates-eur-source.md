# 030 Rates euro source

## Objective

The pair model (spec 027) can already express a quotation of EUR against ARS, and the resolver already
knows how to turn EUR into ARS directly and into USD through the base currency, but no provider writes
the euro: the two clients that exist read dollars against the peso only, so every euro conversion ends
in a 404 for lack of a single row. This spec wires the euro's daily series from ArgentinaDatos into the
sync, writes it with its pair explicit (`base = EUR`, `quote = ARS`) next to the dollar without touching
what the dollar already does, and leaves the shape so that the currency that comes next (BRL, CLP and
UYU already travel in the same payload) is one declaration entry plus a catalog code, not a redesign.

## Current state (pre-check before this spec)

- `integrations/`: `ArgentinaDatosClient.fetchFullSeries()` reads `GET /v1/cotizaciones/dolares` (rows
  of `casa`, `compra`, `venta`, `fecha`) and `DolarApiClient.fetchAll()` reads `GET /v1/dolares` into an
  in-memory intraday cache. Both are dollar against peso; `RatesService` names that pair once, in
  `PROVIDER_PAIR = { base: 'USD', quote: 'ARS' }`.
- `reconcileFull()` filters rows with `casa`, `compra` and `venta` present and `fecha >=
  RATES_SYNC_FROM` (default `2025-01-01`), maps `type = casa` and upserts with `PROVIDER_PAIR`; the
  upsert is `onConflictDoNothing` on `(type, base, quote, date)`.
- `refreshIntradia()` caches the dolarapi rows in memory and `getLatest()` serves from that cache when
  no pair filter is given; with a pair filter `getLatest()` and `getSeries()` read the database.
- `hourlyTick()` decides on the clock of the last full reconcile (`> 6h`, or the first run) and
  `dailyCrossCheck()` warns when `getLastDate('blue')` is more than two days behind.
- `rates_daily` already carries `base` and `quote` with a foreign key to the currency catalog and the
  unique key `(type, base, quote, date)` (spec 027, migration 0017); `buy` and `sell` are
  `numeric(10, 2)`.
- The catalog holds ARS, USD and EUR (`SYSTEM_CURRENCIES`, spec 026).
- Today the euro is unreachable: the smoke of spec 027 asserts that `GET /rates/convert?from=EUR&to=USD`
  answers 404 because there is no path, and `from=EUR&to=ARS` cannot answer either, since no provider
  writes an `EUR` quotation at all. The resolver is ready (spec 027); the data is what is missing. It was
  not re-run against a live backend while writing this spec, because the code and the tests already say
  it and the euro rows do not exist by construction.

## Source verification (by HTTP, 2026-09-27, before writing this spec)

| Probe | What it answered |
|---|---|
| `api.argentinadatos.com/v1/cotizaciones/` | 200. 5,325 rows (642 KB): USD, EUR, BRL, CLP and UYU, 1,065 rows each. Fields `moneda`, `compra`, `venta`, `fecha` and `casa`. For EUR: 975 of the 1,065 rows carry `casa` (`oficial`) from 2024-01-20 on, and the 90 rows before that date have no `casa` key at all. Range 2023-10-22 to 2026-09-27, one row per currency per day, no null side. EUR since 2025-01-01: 628 rows (1068.6165 / 1074.312 on 2025-01-01, 1725.777 / 1739.8328 on 2026-09-27). |
| `api.argentinadatos.com/v1/cotizaciones/euro` | 404. There is no per-currency path, so the whole payload is what a client gets. |
| `api.argentinadatos.com/v1/cotizaciones/dolares` | 200. 30,391 rows (2.98 MB), 8 houses (blue, bolsa, contadoconliqui, cripto, mayorista, oficial, solidario, tarjeta), last date 2026-09-27. Unchanged: this is what the client reads today. |
| `dolarapi.com/v1/cotizaciones` | 200. The current value of the same five currencies, fields `moneda`, `casa`, `nombre`, `compra`, `venta`, `fechaActualizacion`. Only the last value; no history. |
| `dolarapi.com/v1/cotizaciones/eur` | 200. `EUR`, `oficial`, `Euro`, 1725.777 / 1739.8328, `fechaActualizacion` 2026-09-25T16:59:00.000Z (158 bytes). The path is `/eur`: `.../cotizaciones/euro` and `.../v1/euro` answer 404. |
| `dolarapi.com/openapi.json` | Lists `/v1/cotizaciones`, `/v1/cotizaciones/eur`, `/brl`, `/clp` and `/uyu`. Its `Cotizacion` schema requires `moneda`, `casa`, `nombre`, `venta` and `fechaActualizacion`; `compra` is not required. |

### What the verification settles

- The euro has a **historical daily series** (2023-10-22 to the current day, 1,065 days), so this spec
  does not face the case the plan feared, a source with only today's value: the euro's reconcile is
  symmetric with the dollar's, one row per day, with no hole filling and no rule for a missing history.
  A day the source does not publish simply does not exist, and the resolver works on the newest point of
  a pair (spec 027), never on a specific date.
- The current-value-only source for the euro exists (dolarapi `/eur`) and is **not needed**: it is the
  same `oficial` quotation the daily source already publishes for today (the daily source is at
  2026-09-27; dolarapi's stamp is 2026-09-25T16:59Z). The decision is recorded below.
- `casa` is optional in the currency payload (absent in the 90 EUR rows measured), so the mapper cannot
  require it. `compra` and `venta` were present in every row measured, and the existing filter keeps
  requiring them anyway, as it does for the dollar.
- The currency endpoint is one order of magnitude cheaper than the dollar's (642 KB against 2.98 MB), so
  adding the fetch does not change the boot sync's order of magnitude.

## Scope

- In scope:
  - the euro's series in the full reconcile: a method on the ArgentinaDatos client for the currency
    endpoint, the mapping of its rows to `{ type, base, quote, buy, sell, date }`, and the writing with
    `base = EUR`, `quote = ARS`;
  - the declaration of which currencies are ingested (today exactly one entry) and what adding the next
    one costs;
  - the resilience of the sync per source: a euro failure does not take the dollar down, and a dollar
    failure does not skip the euro;
  - the daily cross-check watching the euro's feed as well as blue;
  - the verification: pure assertions on the mappers and one HTTP smoke.
- Out of scope:
  - BRL, CLP and UYU, and every currency outside the catalog: they travel in the same payload, but they
    are not catalog codes yet and this spec only leaves the shape ready;
  - the dolarapi euro endpoint (decision below): the intraday cache and `refreshIntradia()` are not
    touched;
  - assets and price feeds (#36, #38 to #41): the same pattern applied to another domain, with its own
    spec;
  - any schema change or migration: `rates_daily` already has the pair, and no new column is needed;
  - the frontend, and the shape of the existing endpoints (they already answer with the pair and already
    filter by it, spec 027);
  - finances: the snapshot of a movement stays what it was (spec 005).

## Approach

### The source and the client

The euro's series comes from ArgentinaDatos `GET /v1/cotizaciones/`, the same provider that already gives
the dollar's full series. The method goes on the client that exists
(`ArgentinaDatosClient.fetchCurrencies()`) because the rule in `architecture.md` is one class per
provider, and a second class for another path of the same host would be a second adapter for one
provider. The client returns the rows as they arrive, typed
(`{ moneda, casa?, compra, venta, fecha }`), with no filtering and no naming of pairs: that decision
stays in the service, as it does for the dollar today.

### What is written for the euro

- The pair: `base = EUR`, `quote = ARS`. Nothing else in the row says "euro".
- The type: the name of the quotation, and the source's own name for the euro's is `oficial` (the `casa`
  of its rows), which is already the dollar's type for the same family of quotations. The euro therefore
  lands as `type = 'oficial'`, `EUR`/`ARS`, next to the dollar's `oficial`, `USD`/`ARS` from the other
  endpoint. Spec 027 moved the pair out of the type on purpose: the same type on the same day describes
  two pairs, and the pair is what tells them apart.
- A row without `casa` (every EUR day before 2024-01-20 in the measured range) maps to `oficial` instead
  of being dropped: the endpoint carries a single series per currency, so there is no other candidate to
  confuse it with, and discarding data for a missing optional key is worse than naming it with the only
  name the series has. Asserted with a fixture; with the default `RATES_SYNC_FROM` those days are out of
  range anyway.
- `buy` and `sell` take the source's `compra` and `venta` and keep the column's two decimals (1725.777
  is stored as 1725.78), the same rounding the dollar gets today.
- The filter is the dollar's: no row without `compra` or `venta`, no row before `RATES_SYNC_FROM`.

### The currencies that are ingested

The endpoint answers the five currencies in the same shape, and the service ingests what a small
declaration says: today exactly one entry, EUR. The USD rows of this endpoint are deliberately filtered
out, because the dollar already has its own provider with eight houses, and writing the same `USD`/`ARS`
`oficial` quotation from two sources would be two sources of truth for one row. Adding a currency later
is its catalog code (spec 026: only ARS, USD and EUR are valid today) plus one entry in that
declaration: same client, same mapper, same pair, no change in `dal/`, in the resolver or in the
endpoints. Nothing in the schema, in the resolver or in the gateway knows which currencies exist.

### Two mappers in one pure module

Mapping a source's rows into rate entries is what repeats (a dollar row today, a currency row now,
another provider tomorrow), so it moves to `bll/rates/rates-sources.ts` as pure functions, next to
`rate-pair.ts` and for the same reason: no Nest, no database, assertable with plain rows. The dollar's
mapping moves unchanged (same filter, same `fromDate`, same `PROVIDER_PAIR`), and pure assertions on the
old shape lock it before and after the move. The service keeps the wiring: which client feeds which
mapping, the upsert, and the error handling per source.

### The sync per source, and what happens when one of them fails

`reconcileFull()` runs the two legs independently:

- the dollar leg, unchanged: fetch the eight houses, map, upsert;
- the euro leg: fetch the currencies, filter to the declared ones, map, upsert;
- a failure of the euro leg is caught, logged with its source name, and stops neither the dollar leg nor
  the boot; a failure of the dollar leg is kept and rethrown after both legs ran, so it still surfaces
  exactly as today (`POST /rates/sync` answers 500 and the scheduler logs it) but the euro gets its
  chance first;
- the return value stays a number, the count of entries written across sources, so the endpoint's
  contract does not change, and the per-source count goes to the log;
- the reconcile clock stays one (`lastReconcileAt`), set as today at the end of the run: after a euro
  failure the euro is retried by the next full reconcile (the hourly tick past six hours, the boot, or a
  manual sync), and no new retry machinery is added for a daily series;
- idempotence holds for the euro through the same key as the dollar, `(type, base, quote, date)`, and
  the euro path never writes a `USD`/`ARS` key.

### `hourlyTick` and `dailyCrossCheck`

`hourlyTick()` does not change: it keeps deciding on the clock of the last full reconcile, which now
covers both sources. `dailyCrossCheck()` stops watching a single series: it iterates the feeds worth
watching (blue `USD`/`ARS` and the euro `oficial` `EUR`/`ARS`) and warns per feed with its name and its
last date, so a source that goes silent is visible by itself instead of hiding behind the other one.
That needs `RatesRepository.getLastDate(type, base?, quote?)` to accept the pair, a read that stays
parameterized and needs no schema change.

### A type with two pairs, and the unfiltered read

After this spec a type can have more than one pair (`oficial` is both `USD`/`ARS` and `EUR`/`ARS`), so
the existing reads without a pair filter would have to pick one of them with no rule. The decision: the
unfiltered read keeps answering what it answered before this spec, the pair the providers quote against
the peso (`USD`/`ARS`), and the pair filter (`?base=EUR&quote=ARS`, spec 027) is how a caller asks for
the euro. Nothing that worked before changes meaning, and `?type=oficial` alone does not become a coin
toss between two quotations.

### The euro's intraday is not wired (decision)

dolarapi answers the euro's current value at `/v1/cotizaciones/eur`, but it is the same `oficial`
quotation the daily source already publishes for today, it carries no history, and its stamp measured
today was older than the daily series' last day (2026-09-25T16:59Z against 2026-09-27). Wiring it would
mean a second writer of the same `(type, base, quote)` and a second `oficial` in a cache that is keyed by
`casa` alone today, which is exactly what would make `getLatest` ambiguous for the dollar. It is left
out; if intraday euro freshness is wanted later, it is its own spec and the cache has to be keyed by pair
first.

### What is left for the user to decide

- The euro's type name: `oficial` (this spec) or a qualified name such as `euro-oficial`. `oficial` is
  faithful to the source and to 027's rule that the type is the name of the quotation while the pair is
  the identity; a qualified name would keep `?type=oficial` alone meaning only the dollar, at the cost of
  naming the same quotation differently from the provider.
- The client: a method on `ArgentinaDatosClient` (this spec) or a separate file for the currency
  endpoint. One class per provider argues for the method; splitting argues for a smaller class, but it
  duplicates an adapter for one host.
- The intraday euro: out (this spec, for the reasons above) or in, with the cache keyed by pair first.

## Acceptance criteria

- [ ] After a sync, `rates_daily` holds one row per day the source publishes since `RATES_SYNC_FROM`
      with `type = 'oficial'`, `base = 'EUR'`, `quote = 'ARS'` and the source's `compra`/`venta`
      (measured today: 628 days since 2025-01-01, 1,065 in the source's whole range).
- [ ] The dollar is untouched: the row count per type and the `buy`/`sell` of the `USD`/`ARS` rows are
      identical before and after the change (psql comparison, per type).
- [ ] The reconcile is idempotent for the euro too: a second run adds no row and changes no value.
- [ ] `GET /rates/convert?from=EUR&to=ARS&type=oficial` answers `kind: direct` with the euro's `buy` and
      `sell`.
- [ ] `GET /rates/convert?from=EUR&to=USD&type=oficial` answers `kind: cross`, with the rate equal to
      the euro's mid divided by the dollar oficial mid, and the same conversion without `type` no longer
      answers 404 (it was the "no path" case of spec 027).
- [ ] A euro fetch that fails is logged with its source and lets the dollar leg, the boot and the
      endpoint work; a dollar fetch that fails surfaces as today and does not skip the euro leg.
- [ ] A currency row without `casa` maps to `oficial`, and a row without `compra` or `venta` or before
      `RATES_SYNC_FROM` is not stored (pure assertions on rows captured from the source).
- [ ] The unfiltered read of a type that now has two pairs still answers the `USD`/`ARS` quotation.
- [ ] The daily cross-check warns per feed, with the feed's name and its last date, for blue and for the
      euro.
- [ ] Ingesting a second currency is one declaration entry plus its catalog code: a fixture with two
      declared currencies produces two pairs and changes nothing in `dal/`, in the resolver or in the
      endpoints.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- Pure assertions (`apps/backend/test/rates-sources-asserts.mjs`, no database, in the style of
  `rate-pair-asserts.mjs`): the dollar mapping keeps its filter, its `fromDate` and its pair; the
  currency mapping writes `EUR`/`ARS` with type `oficial`; a currency row without `casa` falls back to
  `oficial`; a row with a null side or before `fromDate` is dropped; the USD rows of the currency
  payload are dropped; a fixture with two declared currencies produces two pairs. The final count goes
  to the record.
- HTTP smoke (`apps/backend/test/smoke-030-rates-eur.mjs`) on port 30083, which is free (the twelve
  smokes occupy 30084 to 30099), following the shape of `smoke-027-rates-pair.mjs`: the backend boots and
  answers health; the euro's series (`/rates/series?type=oficial&base=EUR&quote=ARS`) is not empty and
  every point carries that pair; the euro's `buy` and `sell` are positive; the direct conversion equals
  the mid of the newest euro point read from the endpoint, so nothing is hardcoded; the cross to USD
  equals the euro's mid divided by the dollar oficial mid; the pathless case answers 404 for a `type`
  that has no euro quotation (`blue`), which replaces the assertion `smoke-027` makes with
  `EUR -> USD` (that conversion exists now, so its "no path" check has to move from a pair to a type);
  and a `POST /rates/sync` followed by the same count per pair proves idempotence.
  The smoke seeds nothing and asserts no fixed value from the provider. Seeding was considered and
  discarded: the boot runs the real reconcile in every smoke (all twelve do it today, and the scheduler
  swallows its failure, so an outage cannot hang the boot) and its rows would collide with the seeded
  ones on the same key, being ignored by `onConflictDoNothing`; a seeded day the provider does not
  publish would leave a quotation in the test database that never existed and would mix invented days
  into the very counts the smoke checks. The assertions compare the API's own answers among themselves,
  so a legitimate market move never fails the smoke and a missing euro row always does.
- Counts by pair in `rates_daily` with psql on `pyrite_test`, and on `pyrite` when the change lands
  there: rows per `(type, base, quote)` before and after, plus the euro's whole-range count and the count
  per dollar type, as the evidence for the record.
- Regressions: the six assertion suites (34 + 22 + 31 + 19 + 44 + 14) and the twelve smokes stay green,
  with `smoke-027`'s pathless check moved to a type; `apps/backend/test/README.md` gains the new smoke
  and the updated counts.
- `npm run tsc` and `npm run build`.

Result and measurements: `docs/records/030-rates-eur-source.md`.
