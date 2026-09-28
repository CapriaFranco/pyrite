# 031 First run status

## Objective

The onboarding needs two things it cannot ask for today: whether the app was already set up, and a way
to say "I finished". `GET /auth/status` answers whether a section is **unlocked**, not whether it is
**configured**, and `GET /settings` would only answer by handing over the whole table with the
passphrase hash inside. This spec opens one route that answers with a single flag (0/1) and one that
marks the first run as done.

## Current state (pre-check)

- `settings` is a key-value table; `SettingsService` caches it in memory at boot and serves `get`,
  `set` and `all`; `SettingsController` exposes `GET /settings`, `GET /settings/:key` and
  `PUT /settings/:key`.
- The gateway registers one controller per domain in `gateway.module.ts`; the BLL registers one service
  per domain in `bll.module.ts` (providers and exports).
- Measured before writing this: `GET /auth/status` answers `{"login":false,...}`, which means "not
  unlocked"; `GET /settings` returns `auth.password_hash` among its values, so the flag cannot be read
  from that route.
- No table, no column and no migration is needed: the flag is a settings value.

## Scope

- In scope:
  - `GET /setup` -> `{ firstRun: boolean }`, read from the settings service.
  - `POST /setup` -> marks the first run as done and answers the same shape.
  - The key `setup.first_run`, its default and its meaning.
  - A smoke that proves both routes and the default.
- Out of scope:
  - Any table, column or migration.
  - The onboarding screen (frontend, another subtree).
  - The generic `PUT /settings/:key`, and the fact that it exposes every value (recorded as a finding,
    not fixed here).

## Approach

- `bll/setup/setup.service.ts`: the flag lives under `setup.first_run`. `status()` answers
  `firstRun: settings.get(KEY) !== false`, so an absent value is a first run and only an explicit
  `false` closes it: a hand-written nonsense value never hides the onboarding. `complete()` writes
  `false` through `SettingsService.set`, which persists and refreshes the cache.
- `gateway/setup/setup.controller.ts`: `GET /setup` and `POST /setup`, no parameters and no body.
- The flag is app config, so it belongs to `settings` (the same reason spec 012 gave for not using
  `.env`), and reading it through `SettingsService` means no new query and no second source of truth.

## Acceptance criteria

- [ ] `GET /setup` answers `{"firstRun":true}` when the flag was never written.
- [ ] `POST /setup` answers `{"firstRun":false}`, and the next `GET /setup` answers `false`.
- [ ] Both routes take no body and ignore whatever is sent.
- [ ] No schema change and no migration.
- [ ] `npm run tsc` and `npm run build` pass.

## Verification (planned)

- `npx tsc -p apps/backend/tsconfig.json --noEmit` plus the build.
- Smoke `apps/backend/test/smoke-031-first-run.mjs`, on its own port (30081), booting the compiled
  backend against `pyrite_test`: reads `GET /setup`, calls `POST /setup`, reads again, and **leaves the
  table as it found it** (it deletes the row at the end with `pg`, because a shared test database left
  in "already set up" would confuse the next run). It also checks that a nonsense value in the key does
  not hide the first run.
- The frontend that consumes it (`pyrite-fe`, branch `feature/frontend-ui`) is verified separately,
  where the flag decides whether the onboarding appears.
