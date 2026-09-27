import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30094;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendDir,
  env: { ...process.env, BACKEND_PORT: String(PORT), LOG_LEVEL: 'error', DB_NAME: 'pyrite_test' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
let serverLog = '';
child.stdout.on('data', (c) => { serverLog += c.toString(); });

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
  for (let attempt = 0; attempt < 60; attempt += 1) {
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

const stamp = Date.now();
const monthly = { frequencyUnit: 'month', interval: 1, endsMode: 'never' };
const settings = (patch) => request('PUT', '/disputes/settings', patch);
const category = async (name) => (await request('POST', '/finances/categories', { name, type: 'expense' })).body;
const movement = (categoryId, description, amount, date, note) =>
  request('POST', '/finances/movements', {
    type: 'expense', amountCurrency: 'USD', amount, paidCurrency: 'USD', paidAmount: amount,
    currencyCode: 'USD', walletType: 'digital', categoryId, description, note: note ?? null, date,
  });

/** Un pago mensual con su propia categoria, sin declarar: cada caso decide cuando declararla. */
async function paidTask(title, startsOn, categoryName) {
  const cat = await category(categoryName);
  const task = await request('POST', '/tasks', {
    title,
    type: 'pago',
    startsOn,
    recurrence: monthly,
    payment: { mode: 'recurrente', priceFixed: true, priceAmount: '20.00', priceCurrency: 'USD' },
  });
  return { taskId: task.body.id, categoryId: cat.id };
}

const declare = (taskId, categoryId) => request('PUT', `/tasks/${taskId}/category-links`, { categoryIds: [categoryId] });

const firstExpectation = async (taskId) => ((await request('GET', `/tasks/${taskId}/expectations`)).body ?? [])[0];
const run = () => request('POST', '/disputes/run');
const candidatesOf = async (expectationId) =>
  (await request('GET', `/disputes/candidates/${expectationId}`)).body ?? [];
const disputesOf = async () => (await request('GET', '/disputes')).body ?? [];


try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  // ---------- valores por defecto del motor ----------
  // Se dejan explicitos primero: la base de prueba conserva lo que dejo la corrida anterior.
  await settings({
    enabled: true,
    autoLink: false,
    toleranceBefore: 3,
    toleranceAfter: 7,
    reviewThresholdPercent: 15,
    autoLinkMinScore: 85,
    autoLinkMargin: 25,
    suggestionAgeDays: 14,
  });
  const defaults = (await request('GET', '/disputes/settings')).body;
  check(defaults?.autoLink === false, 'el auto-link nace apagado');
  check(defaults?.toleranceBefore === 3 && defaults?.toleranceAfter === 7, 'las tolerancias por defecto son 3 y 7');
  check(defaults?.autoLinkMinScore === 85 && defaults?.autoLinkMargin === 25, 'umbral y margen por defecto en 85 y 25');
  check(defaults?.suggestionAgeDays === 14, 'la consulta envejece a los 14 dias');

  // ---------- la consulta trae puntaje, orden y senales ----------
  const t1 = await paidTask(`Netflix ${stamp}`, day(-1), `scoring-t1-${stamp}`);
  await movement(t1.categoryId, `NETFLIX.COM ${stamp}`, 20, new Date(`${day(-1)}T09:00:00Z`));
  await movement(t1.categoryId, `spotify premium ${stamp}`, 12, new Date(`${day(0)}T09:00:00Z`));
  // La categoria se declara despues de los movimientos: el intake vincula al guardar y este
  // caso necesita la duda del motor, con sus dos candidatos y sus puntajes.
  await declare(t1.taskId, t1.categoryId);
  await run();
  const t1First = await firstExpectation(t1.taskId);
  const t1Candidates = await candidatesOf(t1First.id);
  check(t1First.status === 'suggestion', 'con el switch apagado la duda sigue siendo consulta', `${t1First.status}`);
  check(t1Candidates.length === 2, 'los dos candidatos quedan registrados', `${t1Candidates.length}`);
  check(t1Candidates[0]?.rank === 1 && t1Candidates[1]?.rank === 2, 'los candidatos vienen ordenados');
  check(
    t1Candidates[0]?.score > t1Candidates[1]?.score,
    'el que coincide puntua mas alto',
    `${t1Candidates[0]?.score} vs ${t1Candidates[1]?.score}`,
  );
  check(
    Object.keys(t1Candidates[0]?.signals ?? {}).length === 4,
    'cada candidato explica sus senales',
    `${Object.keys(t1Candidates[0]?.signals ?? {}).join(',')}`,
  );

  // ---------- con el switch prendido y margen suficiente, auto-vincula ----------
  await settings({ autoLink: true, autoLinkMinScore: 40, autoLinkMargin: 15 });
  const t2 = await paidTask(`Netflix dos ${stamp}`, day(-3), `scoring-t2-${stamp}`);
  await movement(t2.categoryId, `NETFLIX.COM ${stamp}`, 20, new Date(`${day(-1)}T09:00:00Z`));
  await movement(t2.categoryId, `spotify premium ${stamp}`, 12, new Date(`${day(0)}T09:00:00Z`));
  await declare(t2.taskId, t2.categoryId);
  await run();
  const t2First = await firstExpectation(t2.taskId);
  check(t2First.status === 'settled', 'con ventaja suficiente el motor vincula solo', `${t2First.status}`);

  // ---------- el historial aprende del vinculo automatico ----------
  const t2History = (await request('GET', `/tasks/${t2.taskId}/match-history`)).body;
  check(t2History?.sampleCount === 1, 'el vinculo automatico suma una muestra', `${t2History?.sampleCount}`);
  check(Math.abs(t2History?.averageDelayDays - 2) < 0.01, 'el atraso aprendido es el real', `${t2History?.averageDelayDays}`);

  // ---------- empate: consulta aunque el switch este prendido ----------
  const t3 = await paidTask(`Spotify ${stamp}`, day(-1), `scoring-t3-${stamp}`);
  await movement(t3.categoryId, `spotify premium uno ${stamp}`, 20, new Date(`${day(-1)}T09:00:00Z`));
  await movement(t3.categoryId, `spotify premium dos ${stamp}`, 20, new Date(`${day(0)}T09:00:00Z`));
  await declare(t3.taskId, t3.categoryId);
  await run();
  const t3First = await firstExpectation(t3.taskId);
  const t3Candidates = await candidatesOf(t3First.id);
  check(t3First.status === 'suggestion', 'un empate no se resuelve solo', `${t3First.status}`);

  // ---------- la respuesta humana pesa el doble en el historial ----------
  // El empate se rompe por id, asi que se elige explicitamente el pago del dia siguiente.
  const allMovements = (await request('GET', '/finances/movements')).body ?? [];
  const laterMovement = allMovements.find((m) => m.description === `spotify premium dos ${stamp}`);
  const chosenCandidate = t3Candidates.find((c) => c.movementId === laterMovement?.id) ?? t3Candidates[0];
  const decided = await request('POST', `/disputes/suggestions/${t3First.id}/decide`, {
    candidateId: chosenCandidate.id,
  });
  const t3History = (await request('GET', `/tasks/${t3.taskId}/match-history`)).body;
  check(decided.body?.status === 'settled', 'elegir un candidato por su id resuelve la consulta', `${decided.body?.status}`);
  check(t3History?.sampleCount === 2, 'la respuesta humana suma dos muestras', `${t3History?.sampleCount}`);
  check(
    Math.abs(t3History?.averageDelayDays - 1) < 0.01,
    'el atraso aprendido sale del vinculo manual',
    `${t3History?.averageDelayDays}`,
  );

  // ---------- margen insuficiente: consulta ----------
  await settings({ autoLinkMargin: 90 });
  const t4 = await paidTask(`Netflix tres ${stamp}`, day(-1), `scoring-t4-${stamp}`);
  await movement(t4.categoryId, `NETFLIX.COM ${stamp}`, 20, new Date(`${day(-1)}T09:00:00Z`));
  await movement(t4.categoryId, `servicio sin relacion ${stamp}`, 19, new Date(`${day(0)}T09:00:00Z`));
  await declare(t4.taskId, t4.categoryId);
  await run();
  const t4First = await firstExpectation(t4.taskId);
  check(t4First.status === 'suggestion', 'con margen exigente la duda se consulta', `${t4First.status}`);

  // ---------- la consulta que nadie responde envejece ----------
  await settings({ suggestionAgeDays: 0 });
  const agedRun = await run();
  const t1After = await firstExpectation(t1.taskId);
  const t1Dispute = (await disputesOf()).find((d) => d.expectationId === t1First.id);
  check(agedRun.body?.aged >= 1, 'la corrida reporta consultas envejecidas', `${agedRun.body?.aged}`);
  check(t1After.status === 'exception', 'la consulta vencida pasa a faltante', `${t1After.status}`);
  check(t1Dispute?.type === 'missing', 'y queda como disputa de faltante', `${t1Dispute?.type}`);

  // ---------- validacion de settings ----------
  await settings({
    autoLink: false,
    autoLinkMinScore: 85,
    autoLinkMargin: 25,
    suggestionAgeDays: 14,
    toleranceBefore: 3,
    toleranceAfter: 7,
  });
  const badTolerance = await settings({ toleranceBefore: -1 });
  const badBool = await settings({ autoLink: 'si' });
  const badAge = await settings({ suggestionAgeDays: 9999 });
  check(badTolerance.status === 400, 'una tolerancia negativa da 400', `${badTolerance.status}`);
  check(badBool.status === 400, 'un booleano invalido da 400', `${badBool.status}`);
  check(badAge.status === 400, 'un envejecimiento fuera de rango da 400', `${badAge.status}`);

  const restored = (await request('GET', '/disputes/settings')).body;
  check(restored?.autoLink === false && restored?.suggestionAgeDays === 14, 'el motor queda como estaba');
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nSCORING EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);

