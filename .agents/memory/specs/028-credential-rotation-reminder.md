# 028 Credential rotation reminder

## Objective

Feature #23. The vault has known for a while when each stored password last changed, and spec 012
recorded the intended consumer of that date: "`last_password_changed_at` plus a settings threshold
drives a 'rotar credenciales' reminder". The threshold was even named (`counts.stale_days`) and never
wired: no code reads it, no migration seeds it, and every credential of the vault looks the same
whether it was rotated yesterday or three years ago. This spec builds the read side: one pure
calculation of credential age, one read endpoint over the vault that answers which credentials went
too long without a rotation, and the validated setting that defines "too long". It rotates nothing,
notifies nobody and touches no schema.

## Current state (pre-check before this spec)

- `counts_accounts.last_password_changed_at` exists since spec 012 (migration 0006). `CountsService`
  sets it on create when the payload carries a password and resets it only when the payload carries a
  password; a metadata edit (name, url, notes, tags) never touches it. The rotation apply of spec 013
  writes ciphertext columns only and leaves `updated_at` alone on purpose, so rotating the passphrase
  does not look like a credential change.
- `counts_password_history.changed_at` is the date the previous password stopped being in use, not the
  date the current one was set: it cannot measure the age of the current credential.
- The vault keeps its metadata plaintext by design (012 access matrix): name, url, username, email,
  credential type, `created_at` and `last_password_changed_at` are readable without unlocking, and
  `CountsAccountView` (`counts-view.ts`) is the shared projection that already carries them. A
  reminder built on ages therefore needs no unlock and decrypts nothing.
- `counts.stale_days` is not a key anywhere: no code reads or writes it, no migration seeds it. It
  appears in two places, both prose: the Decisions block of spec 012 and a comment in
  `dispute-settings.ts` that cites it as an example of the naming convention. Checked against both
  databases: the only `counts.*` setting row that exists is `counts.canary`.
- `counts.weak_threshold` (spec 014) is the closest precedent for this kind of setting: read per run
  through `SettingsService` with an in-code default of 50, and no write path of its own, so whoever
  wants to change it goes through the unvalidated generic `PUT /settings/:key`. `bll/logs/logs.service.ts`
  (spec 023) is the precedent for a small service with its own setting, its own routes and a pure
  module next to it.
- There is no durable date of when a section passphrase was last rotated. `SettingsRepository.persist`
  upserts with `set: { value }` only, so `settings.updated_at` keeps the value of the insert (the
  migrations create no trigger that updates it): the row `counts.canary` of `pyrite_test` still shows
  2026-09-15 21:55:37 although the counts rotations recorded for that same database ran after the
  accounts were created at 21:56. And `rotation_jobs` is not a history: the job row is deleted when
  the swap commits (`RotationService.finish` -> `deleteJob`).

## Scope

- In scope:
  - The pure calculation of credential age and staleness, with `now` received as an argument.
  - The setting `counts.stale_days`: in-code default, read path with fallback, write path validated
    with 400 on nonsense.
  - `GET /counts/stale`, `GET /counts/stale/settings` and `PUT /counts/stale/settings` in the counts
    gateway, plus the service that answers them without unlocking anything.
- Out of scope:
  - Any rotation of a credential, automatic or otherwise. Spec 012 already decided there is none:
    rotating a stored password means logging into that site, so the reminder only reports.
  - The notification and push system (#27), and any scheduling or cron: this spec answers on demand,
    the delivery is another feature.
  - The frontend, the per-card badge and the aggregate panel (#9).
  - Schema changes: no column, no table, no migration. The threshold lives in `settings`, which
    already exists.
  - Acknowledge or snooze per account.
  - The age of a section passphrase (see Approach: there is no date to read today).
  - Extending the reminder to `notes`, `notes_private`, `apis` or `vault`.
  - A query parameter that overrides the threshold for a single call.
  - Any change to the counts write path or to the audits of spec 014.

## Approach

### What the reminder measures: the age of each credential

One number per account: the whole days between `last_password_changed_at` and now, and stale when that
number reaches the threshold. The account is the credential: changing its password through
`PUT /counts/:id` is the only action that resets the age, and it is exactly the manual rotation spec
012 described.

The age of the section passphrase is not part of this. It is not measurable today (nothing durable
records it, see Current state), and it answers a different question: a passphrase protects the whole
vault locally, while a credential ages on someone else's server and is rotated by logging in. One
number covering both would mix two risks and hide which one is being reported. If it is wanted later,
the honest way is to write `<section>.rotated_at` in the settings inside the apply transaction of spec
013 and open a new spec; doing it here would mean inventing a date.

Counts only, and the key does not move because spec 012 already named it. `notes` and `notes_private`
hold content, not credentials; `vault` is a section name with no table (013); `api_keys` rows are
credentials, but the section has no action that replaces the stored key value (the repository only
updates label, detail, group and the validator state), so an age over them could be raised and never
reset. Counts is the only place where a credential exists and the system's own paths can rotate it.

### The threshold

`counts.stale_days`: integer, `0..3650`, default `90`, where `0` means the reminder is off.

- 90 by decision: a quarter is what the user wants to be asked for, and the value is editable. The
  working range is app config in the settings table, never `.env` (spec 012), so there is no reason to
  argue the number here beyond the default.
- `0` is not "stale at once": it is the off switch. A single key carries both the threshold and the
  on/off state, so turning the reminder off does not need a second setting, a second endpoint or a
  second read path. `GET /counts/stale` keeps answering the same shape, with `stale` empty and
  `disabled: true`, so the frontend can show "reminder off" without a second call.
- Read path: a missing value, or a nonsense value stored by hand, falls back to 90 instead of failing.
  The endpoint has to answer even if someone wrote garbage through the generic `PUT /settings/:key`.
- Write path (`PUT /counts/stale/settings`): anything that is not an integer inside the range is a 400.
  A value the user just typed is rejected loudly; a value already stored never breaks a read. `0` is
  valid here: it is the documented way to turn the reminder off.
- No seed and no migration: the default lives in the code and the row is created by the first write
  (`SettingsService.set`).

### The calculation is pure

`bll/counts/credential-age.ts`, no Nest and no database, everything it needs arrives as an argument:

- `ageInDays(now, since)`: whole days between the two dates (`Math.floor` of the difference over
  86_400_000 ms), `null` when there is no date.
- `isStale(ageDays, staleDays)`: `ageDays >= staleDays`, the same "at or over the threshold counts"
  convention as the weak audit (`strength_score <= threshold`). With `staleDays === 0` it answers
  `false` for every age: the off switch lives here, so a service that forgets to check it cannot flag
  the whole vault by accident.
- `parseStaleDays(value)`: an integer inside `0..3650`, or `null`. The service turns that `null` into a
  400 on the write path and into the default on the read path, so the pure module imports no exception.
  `0` parses as a valid value, never as "missing".
- `STALE_DAYS_KEY`, `DEFAULT_STALE_DAYS`, `MIN_STALE_DAYS` (`0`) and `MAX_STALE_DAYS` live here too,
  next to the math that uses them.

`now` is a parameter and never `Date.now()` inside the calculation: the assertions pin dates (including
a leap-year span) instead of depending on the machine clock.

### Service and routes

`bll/counts/counts-reminders.service.ts` (new), registered in `bll.module.ts`:

- Reads the threshold from `SettingsService`, the active accounts carrying a stored password from
  `CountsRepository.findWithStoredPassword` (reused as is: no DAL change, no new query), and the
  projection and tags from `toViews`, so the metadata shape is the one the list and the audits already
  return.
- Requires no unlock and decrypts nothing, which is what makes it usable as the first thing the vault
  screen shows. `CountsAuditsService` requires the unlock because it decrypts; this service does not, so
  it does not belong there.
- An account carrying a password with no date (only reachable by writing the table outside the API) is
  reported as `unknown`, never as stale: the reminder does not invent a date, and the counter exposes
  the case instead of hiding it.
- One log line per run with the threshold and the counters. Nothing it touches is secret, so there is
  nothing to redact.

Routes, inside the counts controller and declared before `@Get(':id')` like `groups` and `audit/*`, so
`stale` is never read as an account id:

```
GET  /counts/stale              active credentials at or over the threshold, oldest first
GET  /counts/stale/settings     the effective threshold
PUT  /counts/stale/settings     set the threshold, 0 turns the reminder off (400 when out of range)
```

```json
{
  "staleDays": 90,
  "disabled": false,
  "checked": 8,
  "stale": 1,
  "unknown": 0,
  "accounts": [{ "id": "...", "name": "...", "ageDays": 201 }]
}
```

- `accounts` is `CountsAccountView` plus `ageDays`: only the stale credentials, ordered by `ageDays`
  descending, and never a secret column (the projection has none).
- `checked` counts the active accounts carrying a password. `stale` and `unknown` are its two disjoint
  subsets: with a date at or over the threshold, and without a date at all. What is left of `checked`
  is fresh. The three counters are what lets the caller tell "nothing is stale" from "nothing could be
  measured".
- The routes mutate nothing: no write, no cache, no state.

### Decisions recorded so they are not re-litigated

- The reminder measures the age of a credential, not the age of a section passphrase.
- Counts only: it is the only section with credentials that the system's own paths can rotate.
- Metadata only: the reminder answers with the section locked and decrypts nothing.
- The setting is the single source of the threshold: no per-call override.

## Acceptance criteria

- [ ] `GET /counts/stale` answers `staleDays`, `checked`, `stale`, `unknown` and `accounts`, where
      `accounts` holds only credentials whose age is at or over the threshold, ordered oldest first,
      each one as the metadata view plus `ageDays`.
- [ ] A credential whose `last_password_changed_at` is inside the threshold is not listed, one exactly
      at the threshold is, and a fraction of a day never rounds an age up to a stale credential.
- [ ] The age is whole days between the date of the credential and the `now` the service passes to the
      pure function: the same two dates answer the same number whenever the calculation runs, and the
      calculation itself reads no clock.
- [ ] An active account carrying a password and no date is counted in `unknown` and never listed as
      stale; active accounts without a stored password (an OAuth credential) and soft-deleted ones are
      outside `checked`.
- [ ] The endpoint answers with the counts section locked, and no returned account carries a secret
      column.
- [ ] `GET /counts/stale/settings` answers the effective threshold: the stored value, or 90 when
      nothing was stored or the stored value is nonsense.
- [ ] `PUT /counts/stale/settings` stores a valid integer (0 included, which turns the reminder off)
      and answers 400 for -1, 1.5, "180x", a value over 3650 and a missing body; the next reading of
      the reminder uses the new value.
- [ ] With the threshold at 0 the reminder answers `disabled: true` and lists no credential as stale,
      whatever the ages are, while `checked` and `unknown` keep counting the same population.
- [ ] A passphrase rotation of the counts section (spec 013) leaves the reminder identical for the same
      accounts: the rotation writes ciphertext columns only and the reminder reads no rotation table.
- [ ] The reminder routes write nothing: no table and no setting row changes because they were called.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- `npx tsc -p apps/backend/tsconfig.json --noEmit` plus `npm run build`.
- Pure assertions, new script `apps/backend/test/credential-age-asserts.mjs`, no framework and no
  database (same style as `rate-pair-asserts.mjs`): whole days for pinned dates (0, 1, 29, 30, 31, a
  leap-year span, a same-instant pair); exactly at the threshold is stale and one day under is not;
  `null` date answers `null` and is never stale; the number does not move with the time of day;
  `parseStaleDays` accepts 0, 90 and 3650 and rejects -1, 1.5, "180x", null, an object and 3651; and
  `isStale` answers `false` for every age when the threshold is 0, which is the off switch.
- Smoke `apps/backend/test/smoke-028-credential-reminder.mjs` on port 30080 (free; 30084 to 30099 are
  taken by 015 to 027), booting the compiled backend against `pyrite_test` like the others. The dates
  are the one thing no route can set, so the smoke seeds three rows of its own in `counts_accounts`
  with the `pg` client the backend already depends on (reading the same `.env`), and removes them at
  the end by the ids it created, never touching the accounts that are already there:
  - one aged credential: `last_password_changed_at = now() - 200 days`;
  - one fresh credential: `last_password_changed_at = now() - 2 days`;
  - one unknown: a password column set with `last_password_changed_at = NULL`.
  Checks: with the default threshold the aged id is the only one of the three listed and it carries
  `ageDays` 200; the fresh id is absent; the unknown one is counted in `unknown` and is not listed;
  `PUT /counts/stale/settings` with `staleDays: 1` makes the fresh id appear and restoring 90 removes
  it; -1, "180x" and 4000 answer 400; `staleDays: 0` answers `disabled: true` with nothing stale, and
  restoring 90 brings the aged id back; no returned account carries `ciphertext`, `iv`, `authTag` or
  `salt`; the counts section is never unlocked during the whole run, which is the standing proof that
  the reminder needs no passphrase. The counters are checked against a reading taken before seeding,
  because `pyrite_test` already holds accounts with dates of their own.
- Passphrase independence, one-off and recorded: with the counts section configured in `pyrite_test`,
  create one throwaway account through `POST /counts` (the section has to be unlocked, so this part is
  manual), read `GET /counts/stale`, run a full `POST /auth/change-passphrase/counts` on that section
  and read the endpoint again: the account keeps the same date and the same `ageDays`. It stays out of
  the smoke because the smoke deliberately never holds a passphrase, and the test database ends under
  the new passphrase.
- Full battery: the six assertion suites and the twelve previous smokes (this spec adds the seventh
  suite and the thirteenth smoke, plus their lines in `apps/backend/test/README.md`).

Result and measurements: `docs/records/028-credential-rotation-reminder.md`.
