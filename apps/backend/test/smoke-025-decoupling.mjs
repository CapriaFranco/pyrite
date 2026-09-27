import { spawn } from 'child_process';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30086;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

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

const CURRENCY = 'ARS';
const FLOW = 'digital';
const today = new Date().toISOString();

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  const category = (await request('POST', '/finances/categories', { name: `decouple-${Date.now()}`, type: 'expense' })).body;
  check(Boolean(category?.id), 'la categoria de prueba se crea');

  const before = (await request('GET', '/finances/balances')).body;
  check(typeof before?.[CURRENCY]?.[FLOW] === 'number', 'los balances se leen', `${before?.[CURRENCY]?.[FLOW]}`);

  // ---------- ocho escrituras simultaneas contra el mismo saldo ----------
  const movement = (amount, description) => ({
    type: 'expense', amountCurrency: 'ARS', amount, paidCurrency: 'ARS', paidAmount: amount,
    currencyCode: CURRENCY, walletType: FLOW, categoryId: category.id, description, date: today,
  });
  const parallel = await Promise.all(
    Array.from({ length: 8 }, (_, index) => request('POST', '/finances/movements', movement(100, `paralelo-${index}-${Date.now()}`))),
  );
  check(parallel.every((answer) => answer.status === 201), 'las ocho entradas se guardan', `${parallel.filter((a) => a.status === 201).length}/8`);

  const afterParallel = (await request('GET', '/finances/balances')).body;
  const movedParallel = Number((before[CURRENCY][FLOW] - afterParallel[CURRENCY][FLOW]).toFixed(2));
  // Con el read-modify-write anterior varias leian el mismo saldo y una pisaba a las otras.
  check(movedParallel === 800, 'los ocho deltas se aplican, ninguno se pierde', `${movedParallel}`);

  // ---------- el borrado revierte exactamente una vez ----------
  const first = parallel[0];
  await request('DELETE', `/finances/movements/${first.body.id}`);
  const afterDelete = (await request('GET', '/finances/balances')).body;
  const movedDelete = Number((afterDelete[CURRENCY][FLOW] - afterParallel[CURRENCY][FLOW]).toFixed(2));
  check(movedDelete === 100, 'el borrado devuelve su delta', `${movedDelete}`);

  await request('DELETE', `/finances/movements/${first.body.id}`);
  const afterDouble = (await request('GET', '/finances/balances')).body;
  check(afterDouble[CURRENCY][FLOW] === afterDelete[CURRENCY][FLOW], 'borrar dos veces no devuelve dos veces', `${afterDouble[CURRENCY][FLOW]}`);

  // ---------- el intake sigue respondiendo sobre el guardado ----------
  const service = (await request('POST', '/finances/categories', { name: `servicio-${Date.now()}`, type: 'expense', isService: true })).body;
  const withIntake = (await request('POST', '/finances/movements', {
    ...movement(500, `servicio-${Date.now()}`), categoryId: service.id,
  })).body;
  check(Boolean(withIntake?.id), 'el movimiento se guarda');
  check(withIntake?.intake?.kind === 'new_task', 'el intake sigue respondiendo sobre lo guardado', `${withIntake?.intake?.kind}`);

  // ---------- calendar sigue leyendo a traves de su dominio ----------
  const calendar = (await request('GET', `/calendar?from=${today.slice(0, 10)}&to=${today.slice(0, 10)}`)).body;
  check(Array.isArray(calendar?.days ?? calendar), 'el calendario sigue respondiendo', `${calendar?.days?.length ?? calendar?.length}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nDESACOPLAMIENTO EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
