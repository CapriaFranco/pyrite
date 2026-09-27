import { spawn } from 'child_process';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30084;
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

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-600));

  // ---------- el par viaja con la cotizacion ----------
  const latest = (await request('GET', '/rates/latest?type=blue')).body;
  check(latest?.base === 'USD' && latest?.quote === 'ARS', 'la cotizacion trae su par', `${latest?.base}/${latest?.quote}`);
  check(Number(latest?.sell) > 0, 'y su valor', `${latest?.sell}`);

  const series = (await request('GET', '/rates/series?type=blue')).body;
  check(Array.isArray(series) && series.length > 0, 'la serie responde', `${series?.length}`);
  check(series[0]?.base === 'USD' && series[0]?.quote === 'ARS', 'cada punto trae el par');

  // ---------- el filtro por par ----------
  const filtered = (await request('GET', '/rates/series?type=blue&base=USD&quote=ARS')).body;
  check(filtered.length === series.length, 'el filtro por par devuelve lo mismo', `${filtered.length}`);
  const empty = (await request('GET', '/rates/series?type=blue&base=EUR&quote=ARS')).body;
  check(empty.length === 0, 'y vacio para un par que no existe', `${empty.length}`);

  // ---------- la conversion ----------
  const direct = (await request('GET', '/rates/convert?from=USD&to=ARS&type=blue')).body;
  check(direct?.kind === 'direct', 'el par cargado se resuelve directo', direct?.kind);
  check(direct?.buy > 0 && direct?.sell > direct?.buy, 'el directo trae los dos lados', `${direct?.buy}/${direct?.sell}`);
  check(Number(direct?.rate) === Number(((direct.buy + direct.sell) / 2).toFixed(6)), 'y el rate es el medio', `${direct?.rate}`);

  const inverse = (await request('GET', '/rates/convert?from=ARS&to=USD&type=blue')).body;
  check(inverse?.kind === 'inverse', 'el par opuesto se resuelve inverso', inverse?.kind);
  check(inverse?.buy === undefined && inverse?.sell === undefined, 'sin inventar lados en el inverso');
  check(Number(inverse?.rate) === Number((1 / direct.rate).toFixed(6)), 'el inverso es uno sobre el directo', `${inverse?.rate}`);

  const samePair = (await request('GET', '/rates/convert?from=ARS&to=ARS')).body;
  check(samePair?.rate === 1, 'la misma moneda es uno', `${samePair?.rate}`);

  // El euro ya tiene su cotizacion (spec 030): el caso sin camino pasa a ser un tipo que no la tiene.
  const noPath = await request('GET', '/rates/convert?from=EUR&to=USD&type=blue');
  check(noPath.status === 404, 'un tipo sin cotizacion de ese par responde 404 y no inventa un rate', `${noPath.status}`);
  const badCurrency = await request('GET', '/rates/convert?from=BTC&to=ARS');
  check(badCurrency.status === 400, 'una moneda fuera del catalogo da 400', `${badCurrency.status}`);
  const badType = await request('GET', '/rates/convert?from=USD&to=ARS&type=noexiste');
  check(badType.status === 404, 'un tipo de cotizacion inexistente da 404', `${badType.status}`);

  // ---------- la moneda base ----------
  const baseBefore = (await request('GET', '/rates/base-currency')).body;
  check(baseBefore?.baseCurrency === 'ARS', 'la moneda base por defecto es el peso', `${baseBefore?.baseCurrency}`);

  const changed = await request('POST', '/rates/base-currency', { baseCurrency: 'EUR' });
  check(changed.status === 201 && changed.body?.baseCurrency === 'EUR', 'la moneda base se puede cambiar', `${changed.body?.baseCurrency}`);
  const afterChange = (await request('GET', '/rates/base-currency')).body;
  check(afterChange?.baseCurrency === 'EUR', 'y queda guardada', `${afterChange?.baseCurrency}`);

  const badBase = await request('POST', '/rates/base-currency', { baseCurrency: 'BTC' });
  check(badBase.status === 400, 'una moneda base que no existe da 400', `${badBase.status}`);
  const restored = await request('POST', '/rates/base-currency', { baseCurrency: 'ARS' });
  check(restored.body?.baseCurrency === 'ARS', 'vuelve a quedar como estaba');

  console.log(failures === 0 ? '\nPARES Y MONEDA BASE EN VERDE' : `\n${failures} chequeo(s) fallan`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

process.exit(failures === 0 ? 0 : 1);
