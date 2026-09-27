import { spawn } from 'child_process';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30085;
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

const today = new Date().toISOString();
const movement = (categoryId, currencyCode, walletType, amount, description) => ({
  type: 'expense', amountCurrency: currencyCode, amount, paidCurrency: currencyCode, paidAmount: amount,
  currencyCode, walletType, categoryId, description, date: today,
});

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  // ---------- el catalogo ----------
  const catalog = (await request('GET', '/finances/currencies')).body;
  const codes = (catalog ?? []).map((row) => row.code);
  check(codes.includes('ARS') && codes.includes('USD') && codes.includes('EUR'), 'el catalogo trae las tres monedas', codes.join(','));
  const euro = (catalog ?? []).find((row) => row.code === 'EUR');
  check(euro?.name === 'Euro' && euro?.decimals === 2, 'la moneda trae su detalle', `${euro?.name}/${euro?.decimals}`);
  check(euro?.position === 3, 'el orden del catalogo se respeta', `${euro?.position}`);

  // ---------- la grilla de balances ----------
  const before = (await request('GET', '/finances/balances')).body;
  check(typeof before?.ARS?.cash === 'number' && typeof before?.EUR?.digital === 'number', 'la grilla trae las tres monedas por flujo');
  check(Object.keys(before ?? {}).length === 3, 'la grilla no tiene claves de mas', Object.keys(before ?? {}).join(','));

  // ---------- el pivote: moneda y flujo separados ----------
  const category = (await request('POST', '/finances/categories', { name: `multi-${Date.now()}`, type: 'expense' })).body;
  const eurBefore = before.EUR.cash;
  const usdDigitalBefore = before.USD.digital;
  const eurMovement = await request('POST', '/finances/movements', movement(category.id, 'EUR', 'cash', 250, `euro-${Date.now()}`));
  const usdMovement = await request('POST', '/finances/movements', movement(category.id, 'USD', 'digital', 75, `usd-${Date.now()}`));
  check(eurMovement.status === 201 && usdMovement.status === 201, 'se guardan movimientos en EUR y en USD', `${eurMovement.status}/${usdMovement.status}`);

  const after = (await request('GET', '/finances/balances')).body;
  check(Number((eurBefore - after.EUR.cash).toFixed(2)) === 250, 'el EUR efectivo baja solo el suyo', `${Number((eurBefore - after.EUR.cash).toFixed(2))}`);
  check(Number((usdDigitalBefore - after.USD.digital).toFixed(2)) === 75, 'el USD digital baja solo el suyo', `${Number((usdDigitalBefore - after.USD.digital).toFixed(2))}`);
  check(after.EUR.digital === before.EUR.digital, 'el otro flujo de la misma moneda no se toca');
  check(after.ARS.cash === before.ARS.cash, 'las otras monedas no se tocan');

  check(eurMovement.body?.currencyCode === 'EUR' && eurMovement.body?.walletType === 'cash', 'el movimiento guarda el par', `${eurMovement.body?.currencyCode}/${eurMovement.body?.walletType}`);

  console.log(failures === 0 ? '\nMULTI-MONEDA EN VERDE' : `\n${failures} chequeo(s) fallan`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

process.exit(failures === 0 ? 0 : 1);
