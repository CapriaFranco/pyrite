import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30087;
const BASE = `http://127.0.0.1:${PORT}`;

/** Los archivos sembrados viven en un directorio propio de la corrida: nunca los de verdad. */
const logDir = mkdtempSync(join(tmpdir(), 'pyrite-smoke-viewer-'));

let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendDir,
  env: {
    ...process.env,
    BACKEND_PORT: String(PORT),
    DB_NAME: 'pyrite_test',
    LOG_DIR: logDir,
    LOG_LEVEL: 'info',
  },
  stdio: ['ignore', 'pipe', 'ignore'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });

async function request(method, path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, type: res.headers.get('content-type') ?? '' };
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

const day = (offset) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const stamp = (offset) => day(offset).replace(/-/g, '');
const entry = (level, msg, reqId) =>
  JSON.stringify({ level, time: `${day(-1)}T10:00:00.000Z`, msg, ...(reqId ? { reqId } : {}), context: 'Smoke024' });

// Archivos muy viejos (como en el humo 023): el roller escribe hoy en este mismo directorio, y una
// fecha cercana se cruzaria con lo que el backend loguea mientras corre.
const today = stamp(0);
const stale = stamp(-4000);
const stale2 = stamp(-3999);
const first = `backend.${stale}.1.log`;
const second = `backend.${stale2}.1.log`;
const errors = `errors.${stale}.1.log`;

try {
  writeFileSync(
    join(logDir, first),
    [
      entry('info', 'arranque del visor', 'req-aaa'),
      entry('warn', 'algo raro', 'req-aaa'),
      '{ esto no es json',
    ].join('\n') + '\n' + '{"level":"info","msg":"a medias',
    'utf8',
  );
  writeFileSync(
    join(logDir, second),
    [entry('error', 'fallo de prueba', 'req-bbb'), entry('info', 'cierre', 'req-bbb')].join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(logDir, errors),
    [entry('error', 'duplicado en el stream de errores', 'req-bbb')].join('\n') + '\n',
    'utf8',
  );
  writeFileSync(join(logDir, 'ajeno.txt'), 'no soy un log', 'utf8');

  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));
  // ---------- el listado ----------
  const listing = (await request('GET', '/logs/files')).body;
  const names = (listing?.files ?? []).map((file) => file.name);
  check(listing?.files?.length >= 3, 'lista los archivos del logger', `${listing?.files?.length}`);
  check(names.includes(first) && names.includes(second), 'estan los dos segmentos sembrados');
  check(names.includes(errors), 'el stream de errores aparece');
  check(listing?.foreign?.includes('ajeno.txt'), 'el archivo ajeno se reporta aparte');
  check(!names.includes('ajeno.txt'), 'el archivo ajeno no se lista como log');
  const seeded = (listing?.files ?? []).find((file) => file.name === first);
  check(seeded?.bytes > 0, 'el tamaño del archivo se mide', `${seeded?.bytes}`);
  check(seeded?.stream === 'backend' && seeded?.segment === 1, 'el stream y el segmento se separan');
  check(listing?.totals?.files >= 3 && listing?.totals?.bytes > 0, 'los totales suman');

  // ---------- la lectura, acotada a los archivos sembrados ----------
  const window = `from=${day(-4000)}&to=${day(-3999)}`;
  const all = (await request('GET', `/logs/entries?${window}`)).body;
  check(all?.entries?.length === 6, 'lee los seis registros del rango', `${all?.entries?.length}`);
  check(all?.entries?.[0]?.context === 'Smoke024', 'los campos se desarman');
  check(!all.entries.some((item) => item.raw.includes('a medias')), 'la linea a medio escribir queda afuera');

  // ---------- filtros ----------
  const errorsOnly = (await request('GET', `/logs/entries?${window}&level=error`)).body;
  check(errorsOnly?.entries?.length === 2, 'filtra por nivel error', `${errorsOnly?.entries?.length}`);
  const twoLevels = (await request('GET', `/logs/entries?${window}&level=warn,error`)).body;
  check(twoLevels?.entries?.length === 3, 'acepta varios niveles a la vez', `${twoLevels?.entries?.length}`);
  const byStream = (await request('GET', `/logs/entries?${window}&stream=errors`)).body;
  check(byStream?.entries?.length === 1, 'filtra por el stream de errores', `${byStream?.entries?.length}`);
  const byReq = (await request('GET', `/logs/entries?${window}&reqId=req-aaa`)).body;
  check(byReq?.entries?.length === 2, 'el reqId aísla una peticion', `${byReq?.entries?.length}`);
  const byText = (await request('GET', `/logs/entries?${window}&q=CIERRE`)).body;
  check(byText?.entries?.length === 1 && byText.entries[0].msg === 'cierre', 'el texto busca sin distinguir mayusculas');
  const oneDay = (await request('GET', `/logs/entries?from=${day(0)}&to=${day(0)}`)).body;
  check(!oneDay.entries.some((item) => item.raw.includes('arranque del visor')), 'el rango deja afuera los otros dias');

  // ---------- paginacion ----------
  const pageOne = (await request('GET', `/logs/entries?${window}&limit=2`)).body;
  check(pageOne?.entries?.length === 2, 'la pagina respeta el limite', `${pageOne?.entries?.length}`);
  check(typeof pageOne?.nextCursor === 'string', 'deja cursor para seguir');
  check(pageOne?.truncated === true, 'marca que el rango no se termino');
  const seen = new Set(pageOne.entries.map((item) => item.raw));
  let cursor = pageOne.nextCursor;
  let gathered = pageOne.entries.length;
  for (let round = 0; cursor && round < 10; round += 1) {
    const page = (await request('GET', `/logs/entries?${window}&limit=2&cursor=${encodeURIComponent(cursor)}`)).body;
    for (const item of page.entries) seen.add(item.raw);
    gathered += page.entries.length;
    cursor = page.nextCursor;
  }
  check(gathered === 6, 'paginando se leen los seis', `${gathered}`);
  check(seen.size === 6, 'ninguna linea se repite entre paginas', `${seen.size}`);

  // ---------- tail y descarga ----------
  const tail = (await request('GET', `/logs/tail?file=${first}&lines=2`)).body;
  check(tail?.entries?.length === 2, 'el tail devuelve las dos ultimas', `${tail?.entries?.length}`);
  check(tail?.entries?.[1]?.level === null, 'la ultima del archivo es la linea corrupta');
  check(!tail.entries.some((item) => item.raw.includes('a medias')), 'el tail no muestra la linea a medio escribir');

  const raw = await request('GET', `/logs/files/${first}/raw`);
  check(raw.status === 200, 'la descarga responde', `${raw.status}`);
  check(raw.type.includes('text/plain'), 'la descarga viene como texto', raw.type);
  check(String(raw.body).includes('arranque del visor'), 'la descarga trae el contenido del archivo');
  check(String(raw.body) === readFileSync(join(logDir, first), 'utf8'), 'la descarga son los bytes exactos');

  // ---------- lo que no se sirve ----------
  const foreign = await request('GET', '/logs/files/ajeno.txt/raw');
  check(foreign.status === 400, 'un archivo ajeno no se descarga', `${foreign.status}`);
  const escape = await request('GET', '/logs/files/notas.txt/raw');
  check(escape.status === 400, 'un nombre con otro formato se rechaza', `${escape.status}`);
  const badLevel = await request('GET', `/logs/entries?level=verbose`);
  check(badLevel.status === 400, 'un nivel que no existe da 400', `${badLevel.status}`);
  const badDay = await request('GET', `/logs/entries?from=ayer`);
  check(badDay.status === 400, 'una fecha mal formada da 400', `${badDay.status}`);
  const badCursor = await request('GET', `/logs/entries?cursor=cualquiera`);
  check(badCursor.status === 400, 'un cursor invalido da 400', `${badCursor.status}`);
  const badLines = await request('GET', `/logs/tail?file=${first}&lines=0`);
  check(badLines.status === 400, 'un tail sin lineas da 400', `${badLines.status}`);
  const badFile = await request('GET', `/logs/tail?file=ajeno.txt`);
  check(badFile.status === 400, 'el tail de un archivo ajeno da 400', `${badFile.status}`);
  const badLimit = await request('GET', `/logs/entries?limit=99999`);
  check(badLimit.status === 400, 'un limite fuera de rango da 400', `${badLimit.status}`);

  // El archivo que el roller escribe hoy tambien se puede leer aunque este abierto.
  const todayName = `backend.${today}.1.log`;
  const todayListed = names.includes(todayName);
  if (todayListed) {
    const todayRead = await request('GET', `/logs/files/${todayName}/raw`);
    check(todayRead.status === 200, 'el archivo de hoy se lee mientras se escribe', `${todayRead.status}`);
  } else {
    check(true, 'el archivo de hoy todavia no existe en el listado (sin trafico suficiente)');
  }

  console.log(failures === 0 ? '\nVISOR DE LOGS EN VERDE' : `\n${failures} chequeo(s) fallan`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
  rmSync(logDir, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
