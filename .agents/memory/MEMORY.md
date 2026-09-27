# Memory - Pyrite (working state only)

Update at session close. This is not a changelog: it is the state of the work.

<!-- Rules (agent-facing):
- Working state only: in flight, next, blocked, open decisions, and norms with no other owner.
- One line per item, no prose, no connectives, no history. If it is readable in git log, a PR, a spec or another bank, it does not go here.
- Norm (true next week regardless of the work) belongs to AGENTS.md or architecture.md; state (changes as work advances) belongs here.
- Caps: State <= 5, Next up <= 5, Open decisions <= 3. Overflow means wrong bank: move it, do not trim it.
- Session close: delete resolved, move escalated. Never duplicate another bank.
-->

## State (in flight)
- specs 028 (recordatorio de rotacion), 029 (multi-entrada en finances) y 030 (fuente del euro): implementadas y verificadas, listas para PR.
- Mergeado en main: specs 022 a 027 (PRs #30, #31 y #37) y el registro de los assets futuros (PR #38).
- Verificacion del backend: `apps/backend/test/` (34 + 22 + 31 + 19 + 44 + 14 + 34 + 28 aserciones y 15 humos HTTP; README adentro).
- Modulos puros copiables a otro proyecto (auditados en la 025): motores de recurrencia, matcher, scorer, retencion y lectura de logs, resolucion de pares, edad de credenciales, validacion de movimientos, fuentes de cotizacion, guards, types/dates y currencies, crypto, integrations.

## Next up
- Abrir los PRs de 028, 029 y 030 (ramas listas y validadas juntas).
- #36 Assets and instruments (acciones, cripto, metales): el frente grande que sigue.
- #27 Notificaciones: el aviso con unidad y cantidad que quedo fuera de la 028.
- Reconcile de tasas: hoy escribe ~4.400 filas una por una en el boot (decenas de segundos).
- UI (#24): el usuario avisa cuando arranca el front.

## Open decisions
- satellite-services/ untracked: commitear o ignorar (local-only). Decidir al final.
