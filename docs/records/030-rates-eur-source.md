# 030 Rates euro source - verification record

Snapshot of what was measured while building. The spec is the technical record; this file is the
evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **28 pure assertions** (`apps/backend/test/rates-sources-asserts.mjs`), no database: the dollar
  mapping keeps its filter (`casa`, both sides, `fromDate`), its type and its pair; the currency
  mapping writes `EUR`/`ARS` with type `oficial` and passes the source's values through; a row
  without `casa` takes the only quotation the series has; a row without `compra` or `venta` or
  before `fromDate` does not enter; the `USD` rows of the currency payload are discarded; a fixture
  with two declared currencies produces two pairs with no per-currency rule; the daily check warns
  per feed with its name and its last date.
- **8 scratch checks without a database** (`temp/rates-legs-check.js`, `temp/` is ignored) over the
  real `RatesService` with fake clients and repository: both legs feed the returned count and write
  their row (`blue USD/ARS` and `oficial EUR/ARS`); a euro failure leaves the dollar written, does
  not throw and logs `Reconcile monedas failed: <message>`; a dollar failure rethrows its own error
  after the euro leg wrote; the daily cross-check warns `Daily check: blue 5 days behind
  (last=...)` and `Daily check: euro has no data at all`.
- The mapper fixtures use the shape the source really answers, measured while writing the spec:
  `casa` is optional (the 90 oldest euro days arrive without it), `compra` and `venta` are present
  in every row, and the payload carries five currencies in one call.

## Decisions taken while building

- **The euro's type is `oficial`**, the source's own name for its quotation; the pair (EUR/ARS) is
  what tells it apart from the dollar's `oficial`, which is exactly what spec 027 moved the pair out
  of the type for.
- **`getLastDate` takes the pair and stopped being raw SQL**: it now uses the same query builder as
  the rest of the repository, so the cross-check watches the euro without a new read and without a
  schema change.
- **The unfiltered read keeps answering the pair the providers quote against the peso** (USD/ARS):
  with two quotations under `oficial`, `?type=oficial` alone could not choose one without a rule.
- **Only the dollar leg can make the sync fail**: the euro is logged and swallowed, so a euro outage
  still lets the boot, the endpoint and the dollar work; the dollar keeps surfacing as it did.
- **The ingested currencies are one constant** (`INGESTED_CURRENCIES`, today `['EUR']`) and the
  mapper takes the list as a parameter, so the fixture with `EUR` and `BRL` shows that the next
  currency costs one entry plus its catalog code and touches no other layer.

## Commits of this branch

- `dbd9c43` feat(backend): el euro en el sync de cotizaciones (spec 030).
- `a181a30` test(backend): aserciones de las fuentes y humo del euro (spec 030).

## Pending (the run that executes them fills this in)

- **HTTP smoke** `smoke-030-rates-eur.mjs` (port 30083, 21 checks): deliberately not run while
  building. Every smoke's boot runs the real reconcile against the providers and writes to the
  shared `pyrite_test`, and the assertions compare the API's own answers among themselves (the
  direct conversion against the newest point of the series, the cross against the euro's mid over
  the dollar's), so a market move never fails them and a missing euro row always does. No fixed
  provider value is asserted and nothing is seeded: a seeded day the provider does not publish
  would leave a quotation that never existed, and on the same key the upsert would ignore it.
- **`smoke-027-rates-pair.mjs`**: its "no path" check moved from `EUR -> USD` to
  `EUR -> USD&type=blue`, because that path exists now. Re-run pending.
- **Counts by pair in `rates_daily`** (psql on `pyrite_test`, and on `pyrite` when the change lands
  there): rows per `(type, base, quote)` before and after, the euro's whole-range count (measured at
  the source while writing the spec: 628 days since 2025-01-01, 1,065 in its whole range) and the
  count per dollar type, as the proof that the dollar is untouched and that a second run adds
  nothing.
- **Regressions**: the other six assertion suites (34 + 22 + 31 + 19 + 44 + 14) and the twelve
  smokes, in series.
- `apps/backend/test/README.md` gains the new smoke and the updated counts (integrated by the
  orchestrator, not in this branch).
