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

## Verification run (measured)

The run that executes the checks already happened, in series over the shared test database
(`pyrite_test`). Everything below was measured there; nothing is estimated.

### HTTP smoke `apps/backend/test/smoke-030-rates-eur.mjs`

21 checks, 0 failures. It verified:

- the euro series answers: 628 points since 2025-01-01;
- every point carries the EUR/ARS pair with the name the source gives it and with its two positive
  sides (1725.78/1739.83);
- EUR against ARS resolves directly, with rate 1732.805, the mid of the two sides of the newest
  point;
- the oficial dollar is still there: 635 points;
- EUR against USD is built through the base currency (cross, rate 1.140003);
- the same conversion without a type no longer answers 404 but 200, which used to be the case with
  no path;
- a type without a euro quotation answers 404 without inventing a rate;
- the series without a pair of a type with two quotations is still the dollar against the peso;
- the manual sync answered 5073 rows without adding any euro row (628 -> 628) nor any dollar row
  (635 -> 635), which is the idempotence.

### Port

The smoke ran on port 30082, not on 30083: 30083 is the one smoke 029 uses and both smokes collided
on the same port. The orchestrator found the collision while validating and the fix is in this branch
as commit `3109dc5` `test(backend): puerto propio para el humo del euro`. The two smokes then ran in
parallel, both green (39 and 21 checks), so the coexistence is proven and not assumed.

### Regressions

- `smoke-027-rates-pair.mjs` was run again (its "no path" check moved to `EUR -> USD` with
  `type=blue`): 22 checks, 0 failures, fully green.
- The six previous assertion suites (34 + 22 + 31 + 19 + 44 + 14): all green, exit 0.
- The new assertions of this spec (`rates-sources-asserts.mjs`, 28): green.
- Smoke non-regression: 018-payments, 021-intake and 026-currencies, green in series.

### Counting

The proof that the dollar is untouched and that a second run adds nothing is the smoke's own counts
above: the euro series length and the dollar series length before and after the manual sync, plus its
5073 written rows. No separate count by pair was taken with psql against `rates_daily` in this run,
so the euro's whole-range count measured at the source while writing the spec stays a source figure.

`apps/backend/test/README.md` gains the new smoke and the updated counts, integrated by the
orchestrator and not in this branch.
