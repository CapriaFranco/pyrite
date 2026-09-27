# 029 Finances multi-entry - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this
file is the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build --workspace=apps/backend` clean.
- **39 HTTP checks** (`apps/backend/test/smoke-029-multi-entry.mjs`, port 30083): **0 failures**. This
  spec has **no pure assertion suite**: what it adds is the HTTP path of the batch (a list validated
  as a unit, all-or-nothing, with the intake per item), so the whole verification of its validation
  is the smoke. There is no `*-asserts.mjs` for 029 and none is missing.
- The numbers the smoke measured, with the batch path as the subject:
  - a batch of rates is stored (**201**); `rateUsed` is computed as paid over amount (**1.5000**) on
    the item that brings no rate, and the rate the item brings (**999.0000**) is respected on the
    other one;
  - a currency outside the catalog answers **400**;
  - an invalid batch stores **no movement and moves no balance**, and **no other pair of the grid is
    touched** (the grid is compared pair by pair, before against after).
- **The defect the user wanted solved, measured on both paths**: a category that does not exist
  answers **400 and not 500**, and an amount of zero answers **400 and not 500**, on the batch and on
  the single path alike; the answer names **which item failed** (its zero-based `index`); in both
  cases nothing is written and no balance moves. A currency outside the catalog, which already
  answered 400 before, still answers 400 on the single path.
- **The edges**: a batch of more than 50 items answers **400** and stores nothing; an empty list
  answers **400**; a body without `movements` answers **400**.
- **The intake per movement**: the batch with a service category inside is stored (**201**), the item
  that is not a service asks nothing (**`intake.kind = none`**) and the service item brings its own
  draft (**`intake.kind = new_task`** with its title).
- **The atomicity, which is the central argument of the spec**: two simultaneous batches are stored
  (**201/201**) and both deltas land, neither is lost (**-130** on `ARS`/`digital` and **-12** on
  `USD`/`cash`, each on its own pair). The balance was already atomic in SQL, measured in spec 025;
  this run confirms it on the new path.
- **The single path still stores** (**201**) and **keeps its shape**: it answers the row with its
  `intake` and no `items` key.
- No regressions (run by the orchestrator, in series): the smokes `018-payments`, `021-intake` and
  `026-currencies` stay green.

## Decisions taken while building

- **One transaction, with the whole list validated before writing.** The rollback alone would give
  atomicity but not a usable error: what is left to answer is a driver error mapped back to a
  position in the payload. Validating first turns an invalid item into a 400 that names it.
- **The FIFO queue and the optimistic versioning were discarded**, and this is not re-litigated: the
  queue adds a component that does not exist (a worker, a durable place for pending items, a way to
  report a late failure) for a concurrent writer that does not exist either, and the balance
  increment is already atomic in SQL, so a version column has nothing left to protect and would turn
  a write that always succeeds into one that fails under contention.
- **The validation lives in one shared pure module** (`bll/finances/movement-input.ts`, no Nest, no
  database) used by both paths, and the **order of its checks is deliberate**: it is what keeps the
  messages of the single path from changing while the new checks (category, amount) are added.
- **The cap of 50 per batch is hard and never truncates in silence**: going over answers 400. It
  keeps the transaction short and stops the endpoint from being used to flood the table.
- **The movements spec itself is still what the intake consumes**: the batch asks the same
  `intakeForSaved` once per saved movement, so a failing engine never costs the batch.
- The residual window stated in the spec stays as it is: a category deleted between the check and the
  insert answers 500 with nothing written (the transaction rolls back).

## Commits of this branch

- `c326ff3` docs(specs): abre la spec 029.
- `8c62152` feat(backend): el lote de movimientos y la validacion compartida (spec 029).

## Not verified

The frontend: recording a session of movements from the UI is #9, and nothing consumes the batch
endpoint yet. There is no dedup or idempotency of a repeated batch, by design (out of scope), and no
schema changed: the batch writes the same tables and columns the single path writes.
