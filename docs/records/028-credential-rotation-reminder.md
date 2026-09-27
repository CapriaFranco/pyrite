# 028 Credential rotation reminder - verification record

Snapshot of what was measured when the feature closed. The spec is the technical record; this file is
the evidence.

## What was verified

- `npm run tsc` clean (backend and frontend) and `npm run build --workspace=apps/backend` clean.
- **34 pure assertions** in green, exit 0, in `apps/backend/test/credential-age-asserts.mjs` and with
  no database: whole days for pinned dates (the same instant, 1, 29, 30 and 31 days, a leap-year span
  that includes a 29th of February, and a fraction of a day that does not count as a day); a missing
  date means no age; `parseStaleDays` accepts `0`, `90` and `3650` and rejects `-1`, `1.5`, a text, a
  `null` and an object, plus `3651`; the setting key is `counts.stale_days`; the default is `90` and the
  accepted range is `0..3650`.
- **38 HTTP checks, 0 failures** in the smoke `apps/backend/test/smoke-028-credential-reminder.mjs`
  (port 30080). The dates are the one thing no route can set, so the smoke seeds three accounts of its
  own (one with 200 days, one with 2 days and one with a stored password and no date) and deletes them
  at the end. Measured in that run:
  - with the default threshold of 90 the aged account is the only one of the three listed, with
    `ageDays` 200; the fresh one does not appear;
  - the account with no date is counted under `unknown` and is never listed;
  - the list goes from the oldest to the newest;
  - no returned account carries a secret column;
  - a 400 for `-1`, `1.5`, a non-numeric text, a value over 3650 and a missing body; a rejected value
    never changes the stored threshold;
  - a nonsense value written by hand into `settings` falls back to the default;
  - lowering the threshold to 1 makes the fresh account appear, and restoring 90 removes it again.
- **The off switch, which is the user's decision**: `staleDays: 0` is stored, the answer carries
  `disabled: true`, no credential is listed, and the counters `checked` (8) and `unknown` (1) keep
  counting the same population as before; restoring 90 turns the reminder back on and the aged account
  returns to the list.
- **No regressions** (run by the orchestrator, in series): the smokes `018-payments`, `021-intake` and
  `026-currencies` are still green.
- **The reminder needs no passphrase and decrypts nothing**: the backend boots against `pyrite_test`
  and the endpoint answers with the section never unlocked at any point of the run. That is the proof
  of the design, not a side effect: the reminder reads plaintext metadata only.

## Decisions taken while building

- **The age measured is the age of each credential**, not the age of a section passphrase: the
  passphrase is not rotated periodically and has no durable date to read, so an age over it would be an
  invented number.
- **`0` is the off switch, not "stale at once"**: `isStale` answers `false` for every age when the
  threshold is 0, and a single setting carries both the threshold and the on/off state.
- **The threshold lives in `settings`, never in `.env`**: `counts.stale_days` is app config of the
  counts section, so changing it is a validated call and not a restart.

## Commits of this branch

- `633986d` docs(specs): abre la spec 028.
- `bb16b9c` feat(backend): el recordatorio de rotacion de credenciales (spec 028).

## Not verified

- The one-off passphrase-rotation check the spec planned (unlock the section, create a throwaway
  account, run a full `POST /auth/change-passphrase/counts` and read the endpoint again) is not part of
  this record. What the run does prove is the stronger half of the same claim: the reminder answered
  every time with the section locked and no unlock happened during the whole run.
- The frontend: the badge per card, the aggregate panel and the "reminder off" copy are UI (#9).
  Nothing consumes the endpoint yet; it answers for whoever builds that screen.
