import { spawn } from 'child_process';
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendRequire = createRequire(resolve(backendDir, 'package.json'));
const { Client } = backendRequire('pg');

const PORT = 30080;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED_PREFIX = 'spec028-recordatorio';
const STALE_DAYS = 90;
const DAYS_AGED = 200;
const DAYS_FRESH = 2;

let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

/** La base de pruebas sale del mismo .env que lee el backend, con los defaults locales. */
function dbConfig() {
  const envPath = resolve(backendDir, '.env');
  const env = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  const pick = (key, fallback) => process.env[key] ?? env[key] ?? fallback;
  return {
    host: pick('DB_HOST', '127.0.0.1'),
    port: Number(pick('DB_PORT', '30010')),
    user: pick('DB_USER', 'pyrite'),
    password: pick('DB_PASSWORD', 'pyrite'),
    database: 'pyrite_test',
  };
}

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendDir,
  env: { ...process.env, BACKEND_PORT: String(PORT), DB_NAME: 'pyrite_test', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok || res.status === 503) return true;
    } catch { /* todavia no escucha */ }
    await sleep(1000);
  }
  return false;
}

/** Las fechas son lo unico que ninguna ruta puede fijar: se siembran a mano y se borran por id. */
const seededIds = [];

async function seedAccount(client, suffix, changedAt) {
  const inserted = await client.query(
    `insert into counts_accounts
       (name, salt, password_ciphertext, password_iv, password_auth_tag, last_password_changed_at, status)
     values ($1, $2, $3, $4, $5, ${changedAt}, 'active')
     returning id`,
    [`${SEED_PREFIX}-${suffix}`, 'seed-salt', 'seed-ciphertext', 'seed-iv', 'seed-auth-tag'],
  );
  const id = inserted.rows[0].id;
  seededIds.push(id);
  return id;
}

/** Ninguna columna cifrada ni su sal pueden viajar en la respuesta. */
const hasSecretColumns = (accounts) => /ciphertext|authTag|"iv"|"salt"/.test(JSON.stringify(accounts));

let client = null;

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  // ---------- el umbral efectivo ----------
  const start = await request('GET', '/counts/stale/settings');
  check(start.status === 200 && start.body?.staleDays === STALE_DAYS, 'el umbral efectivo arranca en 90', `${start.body?.staleDays}`);

  const base = (await request('GET', '/counts/stale')).body;
  check(base?.staleDays === STALE_DAYS && base?.disabled === false, 'el recordatorio arranca encendido', `${base?.staleDays}`);
  check(Number.isInteger(base?.checked) && Number.isInteger(base?.stale) && Number.isInteger(base?.unknown), 'trae los tres contadores', `${base?.checked}/${base?.stale}/${base?.unknown}`);
  check(Array.isArray(base?.accounts) && base.accounts.length === base.stale, 'la lista coincide con el contador stale', `${base?.accounts?.length}`);

  // La seccion nunca se desbloquea: la auditoria que descifra sigue dando 403 todo el humo.
  const locked = await request('GET', '/counts/audit/weak');
  check(locked.status === 403, 'la seccion sigue cerrada y el recordatorio igual responde', `${locked.status}`);

  // ---------- se siembran las tres credenciales ----------
  client = new Client(dbConfig());
  await client.connect();
  const agedId = await seedAccount(client, 'vieja', `now() - interval '${DAYS_AGED} days'`);
  const freshId = await seedAccount(client, 'fresca', `now() - interval '${DAYS_FRESH} days'`);
  const unknownId = await seedAccount(client, 'sin-fecha', 'null');

  const after = (await request('GET', '/counts/stale')).body;
  check(after.checked === base.checked + 3, 'las tres sembradas entran en checked', `${base.checked} -> ${after.checked}`);
  check(after.unknown === base.unknown + 1, 'la que no tiene fecha se cuenta aparte', `${base.unknown} -> ${after.unknown}`);

  const aged = after.accounts.find((account) => account.id === agedId);
  check(aged !== undefined, 'la credencial vieja aparece en el recordatorio');
  check(aged?.ageDays === DAYS_AGED, `y trae sus ${DAYS_AGED} dias enteros`, `${aged?.ageDays}`);
  check(typeof aged?.name === 'string' && aged.name === `${SEED_PREFIX}-vieja`, 'con la metadata de la cuenta', aged?.name);

  check(after.accounts.some((account) => account.id === freshId) === false, 'la fresca no esta');
  check(after.accounts.some((account) => account.id === unknownId) === false, 'la que no tiene fecha nunca se lista');
  check(after.accounts.every((account, index, list) => index === 0 || list[index - 1].ageDays >= account.ageDays), 'la lista va de la mas vieja a la mas nueva');
  check(hasSecretColumns(after.accounts) === false, 'ninguna cuenta devuelve una columna secreta');

  // ---------- el umbral se baja y se vuelve a subir ----------
  const lowered = await request('PUT', '/counts/stale/settings', { staleDays: 1 });
  check(lowered.status === 200 && lowered.body?.staleDays === 1, 'el umbral baja a un dia', `${lowered.status}/${lowered.body?.staleDays}`);
  const withOne = (await request('GET', '/counts/stale')).body;
  check(withOne.staleDays === 1, 'el recordatorio usa el umbral nuevo', `${withOne.staleDays}`);
  check(withOne.accounts.find((account) => account.id === freshId)?.ageDays === DAYS_FRESH, 'con un dia la fresca ya aparece con sus dos dias');

  const restored = await request('PUT', '/counts/stale/settings', { staleDays: STALE_DAYS });
  check(restored.status === 200 && restored.body?.staleDays === STALE_DAYS, 'volver a 90 se guarda', `${restored.body?.staleDays}`);
  const withNinety = (await request('GET', '/counts/stale')).body;
  check(withNinety.staleDays === STALE_DAYS, 'y el recordatorio lo usa', `${withNinety.staleDays}`);
  check(withNinety.accounts.some((account) => account.id === freshId) === false, 'la fresca queda afuera otra vez');
  check(withNinety.accounts.some((account) => account.id === agedId), 'la vieja sigue estando');

  // ---------- lo que no se guarda ----------
  const negative = await request('PUT', '/counts/stale/settings', { staleDays: -1 });
  check(negative.status === 400, 'un negativo da 400', `${negative.status}`);
  const fraction = await request('PUT', '/counts/stale/settings', { staleDays: 1.5 });
  check(fraction.status === 400, 'una fraccion da 400', `${fraction.status}`);
  const text = await request('PUT', '/counts/stale/settings', { staleDays: '180x' });
  check(text.status === 400, 'un texto que no es numero da 400', `${text.status}`);
  const tooBig = await request('PUT', '/counts/stale/settings', { staleDays: 4000 });
  check(tooBig.status === 400, 'por encima del maximo da 400', `${tooBig.status}`);
  const empty = await request('PUT', '/counts/stale/settings');
  check(empty.status === 400, 'sin cuerpo da 400', `${empty.status}`);
  const kept = (await request('GET', '/counts/stale/settings')).body;
  check(kept?.staleDays === STALE_DAYS, 'un rechazo no cambia el umbral guardado', `${kept?.staleDays}`);

  // ---------- un valor absurdo guardado a mano no rompe la lectura ----------
  await request('PUT', '/settings/counts.stale_days', { value: 'garbage' });
  const fallback = (await request('GET', '/counts/stale/settings')).body;
  check(fallback?.staleDays === STALE_DAYS, 'un valor absurdo en settings cae al default', `${fallback?.staleDays}`);
  const withGarbage = (await request('GET', '/counts/stale')).body;
  check(withGarbage.staleDays === STALE_DAYS, 'y el recordatorio tambien', `${withGarbage.staleDays}`);
  await request('PUT', '/counts/stale/settings', { staleDays: STALE_DAYS });

  // ---------- el cero apaga ----------
  const off = await request('PUT', '/counts/stale/settings', { staleDays: 0 });
  check(off.status === 200 && off.body?.staleDays === 0, 'el cero se guarda', `${off.status}/${off.body?.staleDays}`);
  const disabled = (await request('GET', '/counts/stale')).body;
  check(disabled.disabled === true, 'el recordatorio se declara apagado');
  check(disabled.stale === 0 && disabled.accounts.length === 0, 'y no lista ninguna credencial', `${disabled.stale}`);
  check(disabled.checked === after.checked, 'checked sigue contando la misma poblacion', `${disabled.checked}`);
  check(disabled.unknown === after.unknown, 'y unknown tambien', `${disabled.unknown}`);

  const back = await request('PUT', '/counts/stale/settings', { staleDays: STALE_DAYS });
  check(back.status === 200 && back.body?.staleDays === STALE_DAYS, 'el umbral se restaura');
  const backOn = (await request('GET', '/counts/stale')).body;
  check(backOn.disabled === false, 'el recordatorio vuelve a estar encendido');
  check(backOn.accounts.some((account) => account.id === agedId), 'y la vieja vuelve a la lista');

  console.log(failures === 0 ? '\nRECORDATORIO DE ROTACION EN VERDE' : `\n${failures} chequeo(s) fallan`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  try { await request('PUT', '/counts/stale/settings', { staleDays: STALE_DAYS }); } catch { /* el backend ya no responde */ }
  if (client) {
    try {
      if (seededIds.length > 0) {
        await client.query('delete from counts_accounts where id = any($1::uuid[])', [seededIds]);
      }
    } catch (error) {
      console.log(`ERROR  limpieza de las cuentas sembradas: ${error.message}`);
      failures += 1;
    }
    try { await client.end(); } catch { /* ya cerrada */ }
  }
  child.kill();
  await sleep(400);
}

process.exit(failures === 0 ? 0 : 1);
