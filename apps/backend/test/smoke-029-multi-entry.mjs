import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
/** El tope del lote es una constante del backend: el humo la lee en vez de repetir el numero. */
const { MAX_MOVEMENT_BATCH } = require(resolve(backendDir, 'dist/src/bll/finances/movement-input.js'));

const PORT = 30083;
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

/** Un par de la grilla, con los dos decimales que guarda la columna. */
const pair = (grid, currency, flow) => Number((grid?.[currency]?.[flow] ?? 0).toFixed(2));
const difference = (before, after, currency, flow) => Number((pair(after, currency, flow) - pair(before, currency, flow)).toFixed(2));

async function grid() {
  return (await request('GET', '/finances/balances')).body ?? {};
}

/** El conteo total de movimientos activos: lo que dice si algo se escribio o no. */
async function movementCount() {
  const list = (await request('GET', '/finances/movements')).body;
  return Array.isArray(list) ? list.length : -1;
}

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  const stamp = Date.now();
  const expense = (await request('POST', '/finances/categories', { name: `lote-gasto-${stamp}`, type: 'expense' })).body;
  const service = (await request('POST', '/finances/categories', { name: `lote-servicio-${stamp}`, type: 'expense', isService: true })).body;
  check(Boolean(expense?.id) && Boolean(service?.id), 'las categorias de prueba se crean');
  const unknownCategory = '11111111-2222-4333-8444-555555555555';

  /** Un item del lote: ARS digital, salvo lo que se pise. */
  const item = (over = {}) => ({
    type: 'expense', amountCurrency: 'ARS', amount: 100, paidCurrency: 'ARS', paidAmount: 100,
    currencyCode: 'ARS', walletType: 'digital', categoryId: expense.id, description: `lote-${stamp}`, ...over,
  });
  const batch = (movements) => request('POST', '/finances/movements/batch', { movements });

  // ---------- 1. un lote de cinco: tres en el mismo par y dos en otro ----------
  const before = await grid();
  const countBefore = await movementCount();
  const five = [
    item({ description: `lote-uno-${stamp}` }),
    item({ description: `lote-dos-${stamp}` }),
    item({ type: 'income', amount: 250, paidAmount: 250, description: `lote-tres-${stamp}` }),
    item({ amountCurrency: 'USD', paidCurrency: 'USD', currencyCode: 'USD', walletType: 'cash', amount: 40, paidAmount: 40, description: `lote-cuatro-${stamp}` }),
    item({ type: 'income', amountCurrency: 'USD', paidCurrency: 'USD', currencyCode: 'USD', walletType: 'cash', amount: 10, paidAmount: 10, description: `lote-cinco-${stamp}` }),
  ];
  const saved = await batch(five);
  check(saved.status === 201, 'el lote se guarda', `${saved.status}`);
  check(saved.body?.saved === 5 && saved.body?.items?.length === 5, 'la respuesta trae los cinco con su cuenta', `saved=${saved.body?.saved}`);
  check((saved.body?.items ?? []).every((entry, index) => entry?.index === index), 'cada item viaja con su posicion');
  check(
    (saved.body?.items ?? []).map((entry) => entry?.movement?.description).join('|') === five.map((entry) => entry.description).join('|'),
    'cada fila vuelve en el orden en que se mando',
  );

  const after = await grid();
  check((await movementCount()) === countBefore + 5, 'se guardan exactamente cinco movimientos');
  // Dos gastos de 100 y un ingreso de 250 en el mismo par: un solo incremento de 50.
  check(difference(before, after, 'ARS', 'digital') === 50, 'el par repetido mueve el neto de sus tres items', `${difference(before, after, 'ARS', 'digital')}`);
  check(difference(before, after, 'USD', 'cash') === -30, 'el otro par mueve el suyo', `${difference(before, after, 'USD', 'cash')}`);
  check(
    pair(after, 'ARS', 'cash') === pair(before, 'ARS', 'cash') && pair(after, 'USD', 'digital') === pair(before, 'USD', 'digital'),
    'ningun otro par se toca',
  );

  // ---------- 2. la tasa: la del item o la calculada ----------
  const rates = await batch([
    item({ currencyCode: 'ARS', walletType: 'cash', amount: 100, paidAmount: 150, description: `tasa-uno-${stamp}` }),
    item({ currencyCode: 'ARS', walletType: 'cash', amount: 100, paidAmount: 150, rateUsed: 999, description: `tasa-dos-${stamp}` }),
  ]);
  check(rates.status === 201, 'el lote de tasas se guarda', `${rates.status}`);
  check(Number(rates.body?.items?.[0]?.movement?.rateUsed) === 1.5, 'la tasa se calcula como pagado sobre monto', `${rates.body?.items?.[0]?.movement?.rateUsed}`);
  check(Number(rates.body?.items?.[1]?.movement?.rateUsed) === 999, 'la tasa que trae el item se respeta', `${rates.body?.items?.[1]?.movement?.rateUsed}`);

  // ---------- 3. todo o nada: el ultimo item con una moneda fuera del catalogo ----------
  const beforeBad = await grid();
  const countBad = await movementCount();
  const badCurrency = await batch([
    item({ description: `malo-uno-${stamp}` }),
    item({ description: `malo-dos-${stamp}` }),
    item({ currencyCode: 'BTC', description: `malo-tres-${stamp}` }),
  ]);
  check(badCurrency.status === 400, 'una moneda fuera del catalogo da 400', `${badCurrency.status}`);
  check(badCurrency.body?.index === 2, 'la respuesta dice cual item fallo', `${badCurrency.body?.index}`);
  check((await movementCount()) === countBad, 'el lote invalido no guarda ningun movimiento');
  check(JSON.stringify(await grid()) === JSON.stringify(beforeBad), 'el lote invalido no mueve ningun saldo');

  // ---------- 4. el mismo todo o nada con una categoria que no existe y con un monto cero ----------
  const badCategory = await batch([
    item({ description: `cat-uno-${stamp}` }),
    item({ description: `cat-dos-${stamp}` }),
    item({ categoryId: unknownCategory, description: `cat-tres-${stamp}` }),
  ]);
  check(badCategory.status === 400, 'una categoria que no existe da 400 y no 500', `${badCategory.status}`);
  check(badCategory.body?.index === 2, 'la respuesta dice cual item fallo', `${badCategory.body?.index}`);
  check((await movementCount()) === countBad, 'la categoria inexistente no deja nada escrito');
  check(JSON.stringify(await grid()) === JSON.stringify(beforeBad), 'y tampoco mueve un saldo');

  const zero = await batch([item({ description: `cero-uno-${stamp}` }), item({ amount: 0, description: `cero-dos-${stamp}` })]);
  check(zero.status === 400, 'un monto cero da 400 y no 500', `${zero.status}`);
  check(zero.body?.index === 1, 'y dice cual item fallo', `${zero.body?.index}`);
  check((await movementCount()) === countBad, 'el monto cero no deja nada escrito');

  // ---------- 5. el tope y la lista vacia ----------
  const tooMany = await batch(Array.from({ length: MAX_MOVEMENT_BATCH + 1 }, (_, index) => item({ description: `tope-${index}-${stamp}` })));
  check(tooMany.status === 400, `un lote de mas de ${MAX_MOVEMENT_BATCH} items da 400`, `${tooMany.status}`);
  check((await movementCount()) === countBad, 'el lote por encima del tope no guarda nada');
  check((await batch([])).status === 400, 'una lista vacia da 400');
  check((await request('POST', '/finances/movements/batch', {})).status === 400, 'un cuerpo sin movements da 400');

  // ---------- 6. el intake corre una vez por movimiento guardado ----------
  const mixed = await batch([
    item({ description: `intake-plano-${stamp}` }),
    item({ categoryId: service.id, description: `intake-servicio-${stamp}` }),
  ]);
  check(mixed.status === 201, 'el lote con un servicio adentro se guarda', `${mixed.status}`);
  check(mixed.body?.items?.[0]?.intake?.kind === 'none', 'el item que no es servicio no pregunta nada', `${mixed.body?.items?.[0]?.intake?.kind}`);
  check(
    mixed.body?.items?.[1]?.intake?.kind === 'new_task' && mixed.body?.items?.[1]?.intake?.draft?.title === `intake-servicio-${stamp}`,
    'el item de servicio trae su propio borrador',
    `${mixed.body?.items?.[1]?.intake?.kind}`,
  );

  // ---------- 7. el camino simple sigue igual, con las dos validaciones nuevas ----------
  const single = await request('POST', '/finances/movements', item({ categoryId: service.id, description: `suelto-${stamp}` }));
  check(single.status === 201 && Boolean(single.body?.id), 'el camino simple sigue guardando', `${single.status}`);
  check(single.body?.items === undefined && single.body?.intake?.kind === 'new_task', 'el camino simple conserva su forma', `${single.body?.intake?.kind}`);
  const singleBadCategory = await request('POST', '/finances/movements', item({ categoryId: unknownCategory }));
  check(singleBadCategory.status === 400, 'una categoria inexistente en el camino simple da 400 y no 500', `${singleBadCategory.status}`);
  const singleZero = await request('POST', '/finances/movements', item({ amount: 0 }));
  check(singleZero.status === 400, 'un monto cero en el camino simple da 400 y no 500', `${singleZero.status}`);
  const singleBadCurrency = await request('POST', '/finances/movements', item({ currencyCode: 'BTC' }));
  check(singleBadCurrency.status === 400, 'una moneda fuera del catalogo sigue dando 400', `${singleBadCurrency.status}`);

  // ---------- 8. dos lotes a la vez contra el mismo par ----------
  const beforeRace = await grid();
  const race = await Promise.all([
    batch([
      item({ amount: 60, paidAmount: 60, description: `carrera-a-${stamp}` }),
      item({ amountCurrency: 'USD', paidCurrency: 'USD', currencyCode: 'USD', walletType: 'cash', amount: 5, paidAmount: 5, description: `carrera-b-${stamp}` }),
    ]),
    batch([
      item({ amount: 70, paidAmount: 70, description: `carrera-c-${stamp}` }),
      item({ amountCurrency: 'USD', paidCurrency: 'USD', currencyCode: 'USD', walletType: 'cash', amount: 7, paidAmount: 7, description: `carrera-d-${stamp}` }),
    ]),
  ]);
  check(race.every((answer) => answer.status === 201), 'los dos lotes simultaneos se guardan', race.map((answer) => answer.status).join('/'));
  const afterRace = await grid();
  check(difference(beforeRace, afterRace, 'ARS', 'digital') === -130, 'los dos deltas entran, ninguno se pierde', `${difference(beforeRace, afterRace, 'ARS', 'digital')}`);
  check(difference(beforeRace, afterRace, 'USD', 'cash') === -12, 'y el otro par tambien', `${difference(beforeRace, afterRace, 'USD', 'cash')}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nLOTE DE MOVIMIENTOS EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
