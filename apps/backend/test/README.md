# test

Verificadores vivos del backend. No son tests unitarios con framework: son scripts de Node
que corren contra el backend compilado y, los humos, contra la base de pruebas `pyrite_test`
(levantan y apagan el proceso ellos mismos).

## Como se corren

1. Compilar el backend: `npm run build:backend`
2. Desde la raiz del repo (los scripts resuelven el backend por su propia ubicacion, asi que
   tambien funcionan desde `apps/backend`):

```
node apps/backend/test/engine-asserts.mjs                 # 34 aserciones del motor de recurrencia, sin base de datos
node apps/backend/test/matcher-asserts.mjs                # 22 aserciones del matcher de disputas, sin base de datos
node apps/backend/test/scorer-asserts.mjs                 # 31 aserciones del scorer probabilistico, sin base de datos
node apps/backend/test/log-retention-asserts.mjs          # 19 aserciones de la retencion de logs, sin base de datos
node apps/backend/test/log-reader-asserts.mjs             # 44 aserciones del lector de logs, sin base de datos
node apps/backend/test/rate-pair-asserts.mjs              # 14 aserciones de la resolucion de pares, sin base de datos
node apps/backend/test/credential-age-asserts.mjs         # 34 aserciones de la edad de credenciales, sin base de datos
node apps/backend/test/rates-sources-asserts.mjs          # 28 aserciones de las fuentes de cotizacion, sin base de datos
node apps/backend/test/smoke-015-calendar.mjs             # calendario, tareas y pagos
node apps/backend/test/smoke-016-organization.mjs         # arbol de grupos, sectores y ficha
node apps/backend/test/smoke-017-dates.mjs                # fechas multiples, semanal y 29 de febrero
node apps/backend/test/smoke-018-payments.mjs             # prueba gratuita con unidad y cantidad
node apps/backend/test/smoke-019-disputes.mjs             # matcher del motor de disputas, de punta a punta
node apps/backend/test/smoke-020-scoring.mjs              # scoring, historial aprendido y consulta que envejece
node apps/backend/test/smoke-021-intake.mjs               # intake desde finances y grupo de sistema
node apps/backend/test/smoke-023-logs.mjs                 # retencion de logs: boot, intervalo, manual y metricas
node apps/backend/test/smoke-024-logs-viewer.mjs          # visor de logs: listado, filtros, paginacion, tail y descarga
node apps/backend/test/smoke-025-decoupling.mjs           # saldo atomico (ocho escrituras simultaneas), borrado e intake
node apps/backend/test/smoke-026-currencies.mjs           # catalogo de monedas, grilla de balances y pivote moneda x flujo
node apps/backend/test/smoke-027-rates-pair.mjs           # par de las cotizaciones, conversion y moneda base
node apps/backend/test/smoke-028-credential-reminder.mjs  # recordatorio de rotacion: metadatos, umbral y apagado
node apps/backend/test/smoke-029-multi-entry.mjs          # lote de movimientos y validacion compartida
node apps/backend/test/smoke-030-rates-eur.mjs            # euro en el sync y cruce por la moneda base
node apps/backend/test/smoke-031-first-run.mjs            # primer ingreso: el flag 0/1 que lo declara
```

Cada humo usa su propio puerto (30080 a 30099) y sale con codigo 0 solo si todo pasa. Dos humos
pueden correr a la vez sin chocarse: la convivencia de 029 y 030 en paralelo esta probada.

## Requisitos

- El contenedor de Postgres levantado y `pyrite_test` con las migraciones aplicadas. Las
  migraciones se aplican por psql, no con `drizzle-kit migrate`: el porque esta en
  `errors/drizzle-kit-migrate-falla-silencioso`.
- `apps/backend/.env` con las credenciales locales.

## Notas

- Los humos escriben datos de prueba en `pyrite_test` (tareas, grupos, expectativas). Los
  nombres de grupo llevan sufijo por corrida para que se puedan repetir sin chocar con los de
  la vez anterior.
- Los numeros de cobertura quedan en `docs/records/`: 34 aserciones del motor de recurrencia, 22
  del matcher de disputas, 31 del scorer, 19 de la retencion de logs, 44 del lector de logs, 14 de
  la resolucion de pares, 34 de la edad de credenciales, 28 de las fuentes de cotizacion, y 366
  chequeos HTTP repartidos en los dieciseis humos (calendario 18, organizacion 17, fechas 15, pagos 11,
  disputas 38, scoring 25, intake 30, logs 23, visor 39, desacoplamiento 10, monedas 12, pares 22,
  recordatorio 38, lote 39, euro 21, primer ingreso 8).
- Los numeros de cada script se cuentan con `node temp/count-pass.mjs` (scratch) o mirando el
  listado de PASS que imprime cada corrida.
- CI todavia no los corre: haria falta un servicio de Postgres en el workflow. Queda anotado
  como mejora, no como deuda del frente.
