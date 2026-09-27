import { spawn } from 'child_process';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** Humo del euro en el sync de cotizaciones (spec 030), en el estilo de smoke-027. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30082;
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

/** El medio de una cotizacion, que es el rate de referencia (spec 027). */
const mid = (point) => (Number(point.buy) + Number(point.sell)) / 2;
const last = (series) => series[series.length - 1];

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  // ---------- la serie del euro existe y trae su par ----------
  const euroSeries = (await request('GET', '/rates/series?type=oficial&base=EUR&quote=ARS')).body;
  check(Array.isArray(euroSeries) && euroSeries.length > 0, 'la serie del euro responde', `${euroSeries?.length}`);
  check(euroSeries.every((p) => p.base === 'EUR' && p.quote === 'ARS'), 'y cada punto trae el par EUR/ARS');
  check(euroSeries.every((p) => p.type === 'oficial'), 'con el nombre que le da la fuente');
  const euroLatest = last(euroSeries);
  check(Number(euroLatest.buy) > 0 && Number(euroLatest.sell) > 0, 'y sus dos lados son positivos', `${euroLatest.buy}/${euroLatest.sell}`);

  // ---------- la conversion directa ----------
  const direct = (await request('GET', '/rates/convert?from=EUR&to=ARS&type=oficial')).body;
  check(direct?.kind === 'direct', 'el euro contra el peso se resuelve directo', direct?.kind);
  check(direct?.buy === Number(euroLatest.buy) && direct?.sell === Number(euroLatest.sell), 'con los lados del punto mas nuevo de la serie', `${direct?.buy}/${direct?.sell}`);
  check(Number(direct?.rate) === Number(mid(euroLatest).toFixed(6)), 'y el rate es el medio', `${direct?.rate}`);

  // ---------- el cruce por el dolar ----------
  const dollarSeries = (await request('GET', '/rates/series?type=oficial&base=USD&quote=ARS')).body;
  check(Array.isArray(dollarSeries) && dollarSeries.length > 0, 'el dolar oficial sigue estando', `${dollarSeries?.length}`);
  const dollarLatest = last(dollarSeries);

  const cross = (await request('GET', '/rates/convert?from=EUR&to=USD&type=oficial')).body;
  check(cross?.kind === 'cross', 'el euro contra el dolar se arma por la moneda base', cross?.kind);
  check(
    Number(cross?.rate) === Number((mid(euroLatest) / mid(dollarLatest)).toFixed(6)),
    'y el rate es el medio del euro sobre el del dolar',
    `${cross?.rate}`,
  );
  check(cross?.buy === undefined && cross?.sell === undefined, 'sin inventar lados en el cruce');

  // ---------- sin tipo: el caso que antes no tenia camino ----------
  const untiped = await request('GET', '/rates/convert?from=EUR&to=USD');
  check(untiped.status === 200, 'la misma conversion sin tipo ya no responde 404', `${untiped.status}`);
  check(untiped.body?.kind === 'cross' && Number(untiped.body?.rate) > 0, 'y resuelve por el cruce', `${untiped.body?.rate}`);

  // ---------- un tipo sin cotizacion del euro sigue sin camino ----------
  const noPath = await request('GET', '/rates/convert?from=EUR&to=USD&type=blue');
  check(noPath.status === 404, 'un tipo sin cotizacion del euro responde 404 y no inventa un rate', `${noPath.status}`);

  // ---------- la lectura sin par de un tipo con dos cotizaciones ----------
  const unfilteredSeries = (await request('GET', '/rates/series?type=oficial')).body;
  check(Array.isArray(unfilteredSeries) && unfilteredSeries.length > 0, 'la serie sin par de un tipo con dos cotizaciones responde', `${unfilteredSeries?.length}`);
  check(unfilteredSeries.every((p) => p.base === 'USD' && p.quote === 'ARS'), 'y sigue siendo la del dolar contra el peso');
  const unfilteredLatest = (await request('GET', '/rates/latest?type=oficial')).body;
  check(unfilteredLatest?.base === 'USD' && unfilteredLatest?.quote === 'ARS', 'lo mismo la ultima', `${unfilteredLatest?.base}/${unfilteredLatest?.quote}`);

  // ---------- idempotencia: sincronizar de nuevo no agrega nada ----------
  const sync = await request('POST', '/rates/sync');
  check(sync.status === 201 && sync.body?.ok === true && sync.body?.count > 0, 'el sync manual responde', `${sync.body?.count}`);
  const euroAfter = (await request('GET', '/rates/series?type=oficial&base=EUR&quote=ARS')).body;
  check(euroAfter.length === euroSeries.length, 'y no agrega filas del euro', `${euroSeries.length} -> ${euroAfter.length}`);
  const dollarAfter = (await request('GET', '/rates/series?type=oficial&base=USD&quote=ARS')).body;
  check(dollarAfter.length === dollarSeries.length, 'ni del dolar', `${dollarSeries.length} -> ${dollarAfter.length}`);

  console.log(failures === 0 ? '\nEURO EN EL SYNC DE COTIZACIONES EN VERDE' : `\n${failures} chequeo(s) fallan`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

process.exit(failures === 0 ? 0 : 1);

