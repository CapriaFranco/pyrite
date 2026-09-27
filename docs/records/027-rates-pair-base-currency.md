# 027 Rates pair and base currency - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build:backend` clean.
- **The migration ran without errors** on both databases and **no data was lost** (it only adds
  columns, fills them, replaces the unique constraint and adds the foreign keys): the **4.431**
  quotations on `pyrite_test` and the **4.361** on `pyrite` all ended with the pair `USD`/`ARS`, and
  the values stayed the same (the blue quotation is still `1540.00 / 1560.00`).
- **14 pure assertions** (`rate-pair-asserts.mjs`): a direct pair brings both sides and its mid as
  the reference rate; the opposite pair resolves as the inverse and **does not invent sides that do
  not exist**; the same currency is one; a pair with no quotation of its own is built through the
  base currency (each leg resolved with the same rules, so an inverted leg is handled like any
  other) and the reverse composition is the inverse of the forward one; no path answers nothing; a
  requested type picks that quotation and the newest date wins among several.
- **22 HTTP checks** (`smoke-027-rates-pair.mjs`): the quotation carries its pair, the series too,
  the pair filter answers the same and is empty for a pair that does not exist, the direct and
  inverse conversions with the real blue quotation, the same-currency shortcut, the refusals (404
  with no path, 404 for an unknown type, 400 for a currency outside the catalog), and the base
  currency round trip including its 400.
- No regressions: the six assertion suites (34 + 22 + 31 + 19 + 44 + 14) and the eleven previous
  smokes stayed green.

## Decisions taken while building

- **No rounding inside the utility**: each leg is combined at full precision and whoever presents the
  answer rounds it. Rounding each leg before multiplying drifted the crossed rate (1.098 instead of
  1.097561), which the assertions caught.
- **`buy` and `sell` only when the pair exists directly**: on an inverse or a crossed pair there is no
  honest two-sided price for the pair asked for, so the answer carries a single reference rate
  (the mid of every leg) instead of inventing sides.
- **One setting, validated against the catalog**: `finances.base_currency` (default ARS); an unknown
  code is a 400 and never a silent fallback.
- **The providers keep giving the dollar against the peso**, and `PROVIDER_PAIR` names it in one
  place; a euro source is not integrated yet (the model is ready, the data source is not).

## A fragile assumption found in an older smoke

`smoke-024-logs-viewer.mjs` seeded its files with **yesterday's** date and the roller writes in the
same directory: depending on the hour, the backend's own logs landed in the seeded range and the
counts broke (148 entries instead of 6). It now seeds very old dates, like spec 023 does, so what the
backend writes while running can never interfere.

## Not verified

Live browser flow: the screen that shows the equivalences is UI (#9). Nothing consumes the conversion
yet (the snapshot of a movement is still what it was); it is there for the front and for the next
pieces.
