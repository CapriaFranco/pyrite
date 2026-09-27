# Features - SDD index | delete when complete | new ID = last_id + 1

last_id: 42

<!--
One line per feature. Planned features may be registered here without a spec yet (status: pending); a spec is opened when the feature is planned and ready to develop. When a feature is COMPLETE: remove its line here and mark the spec status as completed. SPECS ARE NEVER DELETED - specs/ is a permanent registry, the numbering exists for that. Never reuse an ID; last_id only grows.

Format: #<id> <name> - <one-line summary> [spec: <file>] [status: pending|active|blocked|completed]
-->

#1 Backend skeleton - Nest.js app in apps/backend with layered structure, Drizzle+Redis wiring and /health check [spec: 001-backend-skeleton.md] [status: completed]
#2 Frontend skeleton - Next.js App Router + TS strict + Tailwind v4 in apps/frontend, gateway api client, status view [spec: 002-frontend-skeleton.md] [status: completed]
#3 Config en DB - settings/keys del sistema en DB cargadas al boot (bootstrap de infra via .env) [spec: 003-config-db.md] [status: completed]
#4 Auth core - login passphrase, Argon2id, crypto en capas con perfiles por dominio (light/medium/heavy), KDF+GCM [spec: 004-auth-core.md] [status: completed]
#5 Startup screen - sonido de inicio + mensaje de voz rotativo (ElevenLabs, 2-3 variantes) [status: pending]
#6 APIs section - almacen de API keys con validadores, estado activa/vencida/invalida [spec: 007-api-keys.md] [status: completed]
#7 Finances core - categorias/platformas/balances, movimientos con conversion efectiva snapshot y balance_source [spec: 005-finances-core.md] [status: completed]
#8 Rates sync - sincronizacion diaria de cotizaciones (todos los tipos) desde ArgentinaDatos + intradia dolarapi, reconcile idempotente, cross-check diario [spec: 006-rates-sync.md] [status: completed]
#9 Finances UI - UI de finances; al iniciarse se dispara la sub-spec C (graficos/filtros, spec 005) [status: pending]
#10 Backend restructure - subcarpetas por dominio en dal/bll/gateway, crypto a services, auth separado [spec: 008-backend-restructure.md] [status: completed]
#11 Fix drizzle location - mover schema/migrations/config a apps/backend, build limpio (rootDir ".", dist/src/main.js), scripts orm con cd apps/backend [spec: 009-fix-drizzle-location.md] [status: completed]
#12 Notes backend - notas con modo privado (seccion propia), busqueda por titulo/contenido, tabla groups unificada por dominio [spec: 010-notes-backend.md] [status: completed]
#13 Logging system - pino + pino-roll, correlacion por reqId, redaccion de secretos, rotacion y retencion [spec: 011-logging-system.md] [status: completed]
#17 Notes UI - carpetas, markdown avanzado + math, preview en crear/editar, orden reciente con pin, busqueda titulo/contenido, filtros y modal de passphrase para privadas [status: pending]
#20 Unify Calendar + Tasks + Finances - unificacion de los tres dominios [status: pending]
#24 Calendario y Tasks UI - vista de calendario (mes/dia), pantalla de tasks (carpetas, grupos, kanban opcional) y accesos rapidos con plantillas desde calendar [status: pending]
#23 Credential rotation reminder - recordatorio de rotacion de credenciales (counts.stale_days sin consumidor; spec 012) [status: pending]
#27 Notificaciones y recordatorios - switch de aviso con unidad (segundos/minutos/horas/dias) y cantidad, mas la variante de hora previa al inicio; requiere el sistema de notificaciones [status: pending]
#34 Finances multi-entrada - registrar varios movimientos en una operacion (cola FIFO u optimistic locking con version) [status: pending]
#36 Holdings core - nucleo compartido de los activos: tenencia (instrumento, cantidad, costo de adquisicion, fecha) y valuacion contra el ultimo precio conocido, con serie historica propia; metales, acciones y cripto son tipos sobre este nucleo [status: pending]
#38 Metals - metales como bien economico (oro, plata): cantidad en gramos con pureza (ej. 10 g de oro 24 qt) y precio por metal; no es un saldo nominal [status: pending]
#39 Stocks - acciones: ticker, mercado y cantidad, con precio de mercado y eventos societarios a definir (dividendos, splits) [status: pending]
#40 Crypto - criptomonedas: unidad y red, cantidad y precio de mercado; la red define decimales y direcciones [status: pending]
#41 Price feeds - proveedores de precios por tipo de instrumento (metales, acciones, cripto) con sync programado y serie historica, mismo patron que rates: el core los consume por HTTP desde integrations/, nunca importa su codigo [status: pending]
#42 Rates sources expansion - fuentes de cotizacion para EUR y las monedas que se sumen al catalogo (hoy solo hay proveedores de dolar contra peso) [status: pending]