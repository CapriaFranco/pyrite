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

const PORT = 30081;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'setup.first_run';

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

/** El flag es una fila de settings: se borra al empezar y al terminar, porque la base es compartida. */
const clearFlag = (client) => client.query('delete from settings where key = $1', [KEY]);

let client = null;

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  client = new Client(dbConfig());
  await client.connect();

  // El punto de partida se fija a mano: pyrite_test puede venir con el flag escrito.
  await clearFlag(client);

  const first = await request('GET', '/setup');
  check(first.status === 200 && first.body?.firstRun === true, 'sin flag, la app se declara en primer ingreso', `${first.status}/${first.body?.firstRun}`);

  const completed = await request('POST', '/setup');
  check(completed.status === 201 || completed.status === 200, 'el POST cierra el primer ingreso', `${completed.status}`);
  check(completed.body?.firstRun === false, 'y responde que ya no es el primer ingreso', `${completed.body?.firstRun}`);

  const after = await request('GET', '/setup');
  check(after.body?.firstRun === false, 'la lectura siguiente lo confirma', `${after.body?.firstRun}`);

  const row = await client.query('select value from settings where key = $1', [KEY]);
  check(row.rowCount === 1 && row.rows[0].value === false, 'el flag quedo persistido en la tabla', `${row.rowCount}`);

  const ignored = await request('POST', '/setup', { firstRun: true });
  check(ignored.body?.firstRun === false, 'un cuerpo con otro valor no cambia nada', `${ignored.body?.firstRun}`);

  // El valor absurdo se escribe por la ruta generica, que es como puede llegar de verdad: pasa por
  // el servicio y refresca su cache. Un UPDATE por SQL directo no se veria, porque el servicio lee
  // de memoria (y eso esta bien: es su fuente en runtime).
  await request('PUT', `/settings/${KEY}`, { value: 'garbage' });
  const garbage = await request('GET', '/setup');
  check(garbage.body?.firstRun === true, 'un valor absurdo cuenta como primer ingreso', `${garbage.body?.firstRun}`);

  console.log(failures === 0 ? '\nPRIMER INGRESO EN VERDE' : `\n${failures} chequeo(s) fallan`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  if (client) {
    try {
      await clearFlag(client);
    } catch (error) {
      console.log(`ERROR  limpieza del flag: ${error.message}`);
      failures += 1;
    }
    try { await client.end(); } catch { /* ya cerrada */ }
  }
  child.kill();
  await sleep(400);
}

process.exit(failures === 0 ? 0 : 1);
