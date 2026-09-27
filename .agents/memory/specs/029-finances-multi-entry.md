# 029 Finances multi-entry

## Objective

A movement is saved one request at a time: `POST /finances/movements` takes a single item, so
recording a session of several movements means N requests and N intermediate states, and a mistake
on the third one leaves the first two written. This spec adds the operation that records a list of
movements as one unit: every item validated before anything is written, all the rows and all the
balance moves committed together, the answer item by item, and the same dispute intake the single
path already runs, once per movement.

## Current state (pre-check before this spec)

- `FinancesService.createMovement` saves one movement: it checks the currency and the flow
  (`requireBalanceTarget`), computes `rateUsed = paidAmount / amount` unless the caller brings one,
  inserts the row, and moves the balance with `FinancesRepository.incrementBalance`.
- The balance arithmetic happens inside the SQL statement (spec 025):
  `INSERT ... ON CONFLICT (currency_code, wallet_type) DO UPDATE SET amount = amount + delta::numeric`.
  Concurrency is already solved at statement level, and it was measured: eight simultaneous
  movements against one pair all applied, none lost (`apps/backend/test/smoke-025-decoupling.mjs`).
  There is no version column and no queue anywhere in the backend.
- `POST /finances/movements` (gateway) saves through finances and then asks
  `DisputesIntakeService.intakeForSaved(movement.id)`, merging the answer as an `intake` key. That
  call logs and answers null on failure, so the engine never turns a saved movement into an error
  (spec 025). The confirmation is per movement too: `POST /disputes/intake/confirm` takes one
  `movementId`.
- Nothing in the API takes more than one movement, and `movements` has no unique key other than
  `id`: there is no idempotency mechanism to reuse.
- Two validations only exist today as the shape of the database call: `categoryId` is not checked
  (the foreign key is the only thing that rejects a category that does not exist, as a 500 from the
  driver) and neither are `amount` and `paidAmount` (an `amount` of 0 makes the rate NaN and the
  insert fails as a 500).
- `withTransaction` lives in `dal/drizzle.provider.ts`; the repositories of tasks, disputes and
  rotation open their own transactions with `this.db.transaction`.

## Scope

- In scope: the batch endpoint that takes a list and answers item by item; the validation of the
  whole list before anything is written; the all-or-nothing write of the rows plus the balance
  increments; the intake for each saved movement; one new smoke.
- Out of scope: the frontend (#9); any schema change (the batch writes the same columns the single
  path writes); loading movements from the AI agent; dedup or idempotency of a repeated batch;
  editing or deleting in batch (the delete keeps taking one id); assets (#36).

## Approach

### The mechanism: one transaction, everything validated first

The three candidates were one transaction with the whole list validated up front, a FIFO queue, and
optimistic locking with a version. The first one is chosen; the other two are discarded with their
reasons, so this is not re-litigated later:

- **A FIFO queue adds a component that does not exist** (a worker, a durable place to hold pending
  items, and a way to report a failure that happened after the client was told "queued"), to solve a
  concurrent writer. In this system the writers are one backend process and one user, and the
  balance increment is already atomic in SQL, so serialising in the application would add a stage
  without removing a race.
- **A version column replaces a statement that cannot lose an update with a retry loop.** The
  increment reads and writes in the same statement, so there is no window between the read and the
  write where a delta can be lost: the version has nothing left to protect. It would also turn a
  write that always succeeds into one that fails under contention, and every retry would have to
  carry the whole batch. It is machinery for an impossible race.
- **What is actually missing is atomicity over a list**, not concurrency control: today a session of
  separate requests leaves the state half written when one item is invalid. One transaction gives
  that for free: Postgres commits all the rows and all the increments together or none.

The list is validated before the transaction opens, on purpose: a rollback alone would give
atomicity but not a usable error, because the only thing left to answer would be a driver error
mapped back to a position in the payload. Validating first makes an invalid item a 400 that names
it. The residual window is a category deleted between the check and the insert (a 500, with nothing
written, since the transaction rolls back): acceptable and stated, not hidden.

### The contract

`POST /finances/movements/batch` takes the same item the single path takes, in a list:

```
{ "movements": [ { type, amountCurrency, amount, paidCurrency, paidAmount,
                   currencyCode, walletType, categoryId, description, note?, date?,
                   platformId?, rateUsed? }, ... ] }
```

It answers 201 with the movements and the intake of each one:

```
{ "saved": 3,
  "items": [ { "index": 0, "movement": { ...row... }, "intake": { ...engine answer... } }, ... ] }
```

`index` is the zero-based position in the request, which is what lets a client map an answer back to
the line it sent. `movement` is the row exactly as the single path returns it (no extra key injected
inside it) and `intake` is present only when the engine answered something other than a failure,
the same rule the single path already follows.

The pre-validation covers, per item: currency, flow, category, type, amount and paidAmount as finite
numbers (amount greater than zero, so the rate snapshot is a real number), description not empty, and
a date that parses. The same errors the single path answers today as a 400, plus the two that today
arrive as a 500 (a category that does not exist, an amount that is not usable). The limit is
`MAX_MOVEMENT_BATCH = 50` items, enforced as a 400, never as a silent truncation: the feature is
"several movements in one operation", so 50 is far above the practical case, it keeps the transaction
short (at most 50 inserts plus one increment per pair of the catalog, that is 6), and it is a hard
cap so the endpoint cannot be used to flood the table.

Everything or nothing in both directions: a list where every item is valid stores every row and
applies every increment; a list with one invalid item stores nothing, writes no balance and answers
400 with the `index` of the offending item. An empty list, or a body without `movements`, is a 400.

### The layers

- `bll/finances/movement-input.ts` (new, no Nest, no database): the validation and normalisation of
  one item, answering either the validated item or the reason it is not one. One source of truth for
  what a movement input is.
- `FinancesService.createMovementBatch(inputs)`: validates the list in order (first failure wins,
  with its index), resolves the categories of the batch in **one** query (the distinct ids, active
  ones only), computes each rate as `paidAmount / amount` unless the item brought one, aggregates the
  balance deltas per currency and flow, and calls the repository once. `createMovement` is not
  removed: it stays as the path of one item and delegates its checks to the same module.
- `FinancesRepository.insertMovementsWithBalances(rows, deltas)`: opens one transaction with
  `this.db.transaction`, inserts the rows in a single `insert().values(rows).returning()`, applies one
  increment per pair with the arithmetic of spec 025, and returns the rows in the order they were
  sent. The deltas are aggregated by the service (three items on the same pair are one increment, and
  a pair whose deltas net to zero writes nothing: the grid answers 0 for a pair with no row, so the
  observable balance is the same), and they are applied sorted by currency and then flow, so two
  concurrent batches take the row locks in the same order and cannot deadlock. No isolation level
  above the default is needed: each increment is one statement on the current value of the row.
- `gateway/finances/finances.controller.ts`: the new route next to the single one, doing the same
  composition as today (finances saves, the gateway asks the engine).

### The intake

The intake runs after the commit, once per saved movement, in payload order, and each answer travels
with its item. Discarded: answering only "N saved", because the question the engine asks is per
movement and its answer is per movement as well (`POST /disputes/intake/confirm` takes one
`movementId`), so an aggregated count would lose exactly what the user has to answer; and running the
intake inside the transaction or before saving, because it is a post-save step by design since 025,
it can create a task and settle an expectation, and its failure must never undo a saved movement.

Failures stay isolated: every call goes through `intakeForSaved`, which logs and answers null, so one
engine failure never costs the batch or the other answers. A batch pays N evaluations, which is what
N separate requests pay today.

### Open points for the user

1. **The single path on the shared validator.** The proposal is that `createMovement` also uses
   `movement-input.ts`, which changes two answers on `POST /finances/movements`: a categoryId that
   does not exist and an amount that is not usable stop being 500 and become 400. It is one module
   instead of two validators for the same domain, and no client depends on a 500. If the user prefers
   the single endpoint byte-identical, the batch keeps the validator and the single path keeps its
   own; the recommendation is to unify.
2. **`intake` when the engine has nothing to say.** Today a movement whose category is not a service
   still carries `intake: { kind: 'none' }`. With N items that is N boxes of nothing in one answer.
   The proposal is to keep the current rule for now (omitting it is a change of the single path too).
3. **The limit of 50.** A number the user can move; what matters is that there is one and that going
   over answers 400.

## Acceptance criteria

- [ ] A batch of N valid items stores exactly N movements, and every balance moves by the sum of the
      deltas of its items (income adds `paidAmount`, expense subtracts it) on the currency and flow
      each item names, with no other pair touched.
- [ ] A batch whose last item is invalid stores nothing: the movement count and the balance grid are
      exactly what they were before, and the answer is 400 carrying the zero-based `index` of the
      invalid item.
- [ ] Items of the same batch touching the same pair, and items touching different pairs, are both
      correct, mixed income and expense included.
- [ ] A batch of more than `MAX_MOVEMENT_BATCH` items answers 400 and stores nothing; an empty list
      answers 400.
- [ ] `rateUsed` of every stored row is `paidAmount / amount`, or the `rateUsed` the item brought,
      exactly as in the single path.
- [ ] `POST /finances/movements` answers and stores exactly as before, and the movements stored by
      the earlier specs are unchanged.
- [ ] The intake runs once per saved movement: an item in a service category carries its own
      `intake.kind = new_task` with the draft, and an item that asks for nothing carries `none`.
- [ ] An intake failure leaves the batch saved, with `intake` absent on that item only.
- [ ] Two batches issued at the same time against the same currency and flow apply both, with no lost
      delta and no deadlock.
- [ ] No schema change: the batch writes the same tables and columns the single path writes.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- New smoke `apps/backend/test/smoke-029-multi-entry.mjs`, port 30083 (the ports in use start at
  30086), against `pyrite_test`, following the pattern of `smoke-025-decoupling.mjs`: it starts the
  compiled backend itself, measures the balance grid before and after, and exits non-zero if any
  check fails. It is listed in `apps/backend/test/README.md` with the others.
  1. a batch of five items, three on the same pair (two expenses and one income) and two on another
     pair, with the grid read before and after and compared pair by pair against the expected sum;
  2. a batch of three where the last item names a currency outside the catalog: 400 with `index: 2`,
     and the movement count plus the grid identical to before;
  3. a batch of three where the last item names a category that does not exist: same check, which is
     the atomicity case a sequence of separate requests would not pass;
  4. a batch of `MAX_MOVEMENT_BATCH + 1` items: 400 and nothing stored;
  5. one item in a service category among plain ones: that item carries `intake.kind = new_task`
     with its draft, the others carry `none`;
  6. the single path still answers 201 with its own shape.
- Counts: the movements before and after come from `GET /finances/movements`, and the balances from
  `GET /finances/balances`, per pair, with the arithmetic of the batch done on the script side.
- Full battery: the six assertion suites and the thirteen HTTP smokes (the new one included).

Result and measurements: `docs/records/029-finances-multi-entry.md`.
