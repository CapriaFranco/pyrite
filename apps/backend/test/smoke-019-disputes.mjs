import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30095;
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

/** Dias relativos a hoy: el motor lee el reloj real, asi que las fechas se calculan. */
const day = (offset) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const stamp = Date.now();
const monthly = { frequencyUnit: 'month', interval: 1, endsMode: 'never' };

const category = async (name) => (await request('POST', '/finances/categories', { name, type: 'expense' })).body;
const paymentTask = async (title, startsOn, payment) =>
  request('POST', '/tasks', { title, type: 'pago', startsOn, recurrence: monthly, payment });
const declare = (taskId, categoryId) => request('PUT', `/tasks/${taskId}/category-links`, { categoryIds: [categoryId] });
const movements = async (categoryId, description, paidAmount, date, amount = paidAmount) =>
  request('POST', '/finances/movements', {
    type: 'expense', amountCurrency: 'USD', amount, paidCurrency: 'USD', paidAmount,
    currencyCode: 'USD', walletType: 'digital', categoryId, description, date,
  });
const expectationsOf = async (taskId) => (await request('GET', `/tasks/${taskId}/expectations`)).body ?? [];
const disputesOf = async (query = '') => (await request('GET', `/disputes${query}`)).body ?? [];
const linkOf = async (expectationId) => (await request('GET', `/disputes/links/${expectationId}`)).body;

try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  // ---------- faltante: la ventana cerro y no hay movimiento ----------
  const c1 = await category(`disputes-missing-${stamp}`);
  const t1 = await paymentTask(`Faltante ${stamp}`, day(-10), { mode: 'recurrente', priceFixed: false, priceAmount: null, priceCurrency: 'ARS' });
  await declare(t1.body.id, c1.id);
  const run1 = await request('POST', '/disputes/run');
  const t1Expectations = await expectationsOf(t1.body.id);
  const t1Disputes = (await disputesOf()).filter((d) => d.taskId === t1.body.id);
  check(run1.status === 201, 'la corrida manual responde', `${run1.status}`);
  check(t1Expectations[0]?.status === 'exception', 'el faltante deja la expectativa en excepcion', `${t1Expectations[0]?.status}`);
  check(t1Disputes.length === 1 && t1Disputes[0].type === 'missing', 'abre una disputa de faltante', `${t1Disputes.length}`);

  const run2 = await request('POST', '/disputes/run');
  check(
    (await disputesOf()).filter((d) => d.taskId === t1.body.id).length === 1,
    'una segunda corrida no duplica la disputa',
    `${run2.status}`,
  );

  // ---------- conciliado: un movimiento en la ventana ----------
  const c2 = await category(`disputes-settle-${stamp}`);
  const t2 = await paymentTask(`Conciliada ${stamp}`, day(-2), { mode: 'recurrente', priceFixed: true, priceAmount: '20.00', priceCurrency: 'USD' });
  await declare(t2.body.id, c2.id);
  await movements(c2.id, `NETFLIX.COM ${stamp}`, 20, new Date(`${day(-1)}T12:00:00Z`));
  await request('POST', '/disputes/run');
  const t2First = (await expectationsOf(t2.body.id))[0];
  const t2Link = await linkOf(t2First.id);
  check(t2First.status === 'settled', 'un movimiento en la ventana concilia la expectativa', `${t2First.status}`);
  check(t2Link?.link?.matchedBy === 'declared', 'el link queda marcado como automatico', `${t2Link?.link?.matchedBy}`);
  check(Number(t2Link?.link?.amountDeviation) === 0, 'el desvio de monto se mide', `${t2Link?.link?.amountDeviation}`);
  check(t2Link?.link?.reviewNote === null, 'sin desvio no hay nota de revision');

  // ---------- desvio de monto: se concilia igual y deja nota ----------
  const c3 = await category(`disputes-deviation-${stamp}`);
  const t3 = await paymentTask(`Desvio ${stamp}`, day(-3), { mode: 'recurrente', priceFixed: true, priceAmount: '20.00', priceCurrency: 'USD' });
  await declare(t3.body.id, c3.id);
  await movements(c3.id, `Servicio convertido ${stamp}`, 15, new Date(`${day(-2)}T12:00:00Z`));
  await request('POST', '/disputes/run');
  const t3First = (await expectationsOf(t3.body.id))[0];
  const t3Link = await linkOf(t3First.id);
  check(t3First.status === 'settled', 'un desvio grande no invalida el match', `${t3First.status}`);
  check(String(t3Link?.link?.reviewNote ?? '').includes('-25.00'), 'el desvio queda como nota de revision', `${t3Link?.link?.reviewNote}`);

  // ---------- precio rotativo: no hay monto contra que comparar ----------
  const c4 = await category(`disputes-rotating-${stamp}`);
  const t4 = await paymentTask(`Rotativo ${stamp}`, day(-2), { mode: 'recurrente', priceFixed: false, priceAmount: null, priceCurrency: 'ARS' });
  await declare(t4.body.id, c4.id);
  await movements(c4.id, `Luz ${stamp}`, 23579, new Date(`${day(-2)}T12:00:00Z`));
  await request('POST', '/disputes/run');
  const t4First = (await expectationsOf(t4.body.id))[0];
  const t4Link = await linkOf(t4First.id);
  check(t4First.status === 'settled', 'el precio rotativo concilia sin comparar montos', `${t4First.status}`);
  check(t4Link?.link?.amountDeviation === null && t4Link?.link?.reviewNote === null, 'sin estimado no hay desvio ni nota');

  // ---------- dos candidatos: consulta, nunca adivina ----------
  const c5 = await category(`disputes-ambiguous-${stamp}`);
  const t5 = await paymentTask(`Ambigua ${stamp}`, day(-1), { mode: 'recurrente', priceFixed: true, priceAmount: '10.00', priceCurrency: 'USD' });
  // Los dos movimientos entran antes de declarar la categoria: el intake vincula al guardar, y
  // este caso necesita que los dos candidatos esten presentes cuando corre el motor.
  await movements(c5.id, `Candidato A ${stamp}`, 10, new Date(`${day(-1)}T09:00:00Z`));
  await movements(c5.id, `Candidato B ${stamp}`, 12, new Date(`${day(0)}T09:00:00Z`));
  await declare(t5.body.id, c5.id);
  await request('POST', '/disputes/run');
  const t5First = (await expectationsOf(t5.body.id))[0];
  const t5Candidates = (await request('GET', `/disputes/candidates/${t5First.id}`)).body ?? [];
  check(t5First.status === 'suggestion', 'dos candidatos dejan la expectativa en consulta', `${t5First.status}`);
  check(t5Candidates.length === 2, 'las dos opciones quedan registradas', `${t5Candidates.length}`);

  const decide = await request('POST', `/disputes/suggestions/${t5First.id}/decide`, { movementId: t5Candidates[0].movementId });
  const t5Link = await linkOf(t5First.id);
  check(decide.body?.status === 'settled', 'elegir un candidato resuelve la consulta', `${decide.body?.status}`);
  check(t5Link?.link?.matchedBy === 'manual', 'la respuesta humana marca el link como manual', `${t5Link?.link?.matchedBy}`);

  // ---------- no planificado: movimiento declarado que nadie esperaba ----------
  const c6 = await category(`disputes-unplanned-${stamp}`);
  const t6 = await paymentTask(`Futura ${stamp}`, day(20), { mode: 'recurrente', priceFixed: true, priceAmount: '30.00', priceCurrency: 'USD' });
  await declare(t6.body.id, c6.id);
  const unplannedMovement = await movements(c6.id, `Cobro no esperado ${stamp}`, 30, new Date(`${day(0)}T09:00:00Z`));
  await request('POST', '/disputes/run');
  const t6Disputes = (await disputesOf()).filter((d) => d.taskId === t6.body.id);
  check(t6Disputes.length === 1 && t6Disputes[0].type === 'unplanned', 'un movimiento que nadie esperaba abre no planificado', `${t6Disputes[0]?.type}`);

  // ---------- tardio: el pago llego despues de la ventana ----------
  const c7 = await category(`disputes-late-${stamp}`);
  const t7 = await paymentTask(`Tardia ${stamp}`, day(-12), { mode: 'recurrente', priceFixed: true, priceAmount: '15.00', priceCurrency: 'USD' });
  await declare(t7.body.id, c7.id);
  const lateMovement = await movements(c7.id, `Pago tardio ${stamp}`, 15, new Date(`${day(-2)}T09:00:00Z`));
  await request('POST', '/disputes/run');
  const t7First = (await expectationsOf(t7.body.id))[0];
  const t7Dispute = (await disputesOf()).find((d) => d.expectationId === t7First.id);
  check(t7First.status === 'exception' && t7Dispute?.type === 'late', 'un pago fuera de la ventana pregunta si fue tardio', `${t7Dispute?.type}`);

  const paidLate = await request('POST', `/disputes/${t7Dispute.id}/resolve`, {
    resolution: 'paid_late',
    movementId: lateMovement.body.id,
    note: 'pague tarde',
  });
  const t7Link = await linkOf(t7First.id);
  check(paidLate.body?.status === 'resolved', 'resolver pagado tarde cierra la disputa', `${paidLate.body?.status}`);
  check(t7Link?.link?.matchedBy === 'manual', 'el pago tardio queda vinculado a mano', `${t7Link?.link?.matchedBy}`);

  // ---------- cancelado: la task se da de baja y el futuro se cancela ----------
  const c8 = await category(`disputes-cancelled-${stamp}`);
  const t8 = await paymentTask(`Cancelada ${stamp}`, day(-20), { mode: 'recurrente', priceFixed: false, priceAmount: null, priceCurrency: 'ARS' });
  await declare(t8.body.id, c8.id);
  await request('POST', '/disputes/run');
  const t8Dispute = (await disputesOf()).find((d) => d.taskId === t8.body.id && d.type === 'missing');
  await request('POST', `/disputes/${t8Dispute.id}/resolve`, { resolution: 'cancelled', taskStatus: 'paused' });
  const t8Task = (await request('GET', `/tasks/${t8.body.id}`)).body;
  const t8Expectations = await expectationsOf(t8.body.id);
  check(t8Task?.status === 'paused', 'cancelar pausa la task', `${t8Task?.status}`);
  const t8Future = t8Expectations.filter((e) => e.expectedOn >= day(0));
  check(t8Future.length > 0 && t8Future.every((e) => e.status === 'cancelled'), 'el futuro se cancela', `${t8Future.filter((e) => e.status !== 'cancelled').length} sin cancelar`);

  // ---------- no registrado: sigue esperando ----------
  const c9 = await category(`disputes-unregistered-${stamp}`);
  const t9 = await paymentTask(`No registrada ${stamp}`, day(-15), { mode: 'recurrente', priceFixed: false, priceAmount: null, priceCurrency: 'ARS' });
  await declare(t9.body.id, c9.id);
  await request('POST', '/disputes/run');
  const t9Dispute = (await disputesOf()).find((d) => d.taskId === t9.body.id && d.type === 'missing');
  const notRegistered = await request('POST', `/disputes/${t9Dispute.id}/resolve`, { resolution: 'not_registered' });
  const t9First = (await expectationsOf(t9.body.id))[0];
  check(notRegistered.body?.status === 'resolved', 'no registrado cierra la disputa', `${notRegistered.body?.status}`);
  check(t9First.status === 'pending', 'la expectativa vuelve a esperar su movimiento', `${t9First.status}`);

  // ---------- consumo unico: el movimiento no se reutiliza ----------
  const c10 = await category(`disputes-consumed-${stamp}`);
  const t10 = await paymentTask(`Consumo ${stamp}`, day(-30), { mode: 'recurrente', priceFixed: true, priceAmount: '25.00', priceCurrency: 'USD', trialCount: 30, trialUnit: 'day' });
  await declare(t10.body.id, c10.id);
  await movements(c10.id, `Un solo pago ${stamp}`, 25, new Date(`${day(-2)}T09:00:00Z`));
  await request('POST', '/disputes/run');
  const t10Expectations = await expectationsOf(t10.body.id);
  const settledInT10 = t10Expectations.filter((e) => e.status === 'settled');
  check(settledInT10.length === 1, 'un movimiento paga una sola expectativa', `${settledInT10.length}`);

  // ---------- desvincular libera el movimiento ----------
  const t2Unlinked = await request('DELETE', `/disputes/links/${t2First.id}`);
  const t2AfterUnlink = (await expectationsOf(t2.body.id))[0];
  check(t2Unlinked.status === 200 && t2Unlinked.body?.movementId === t2Link.link.movementId, 'desvincular devuelve el movimiento');
  check(t2AfterUnlink.status === 'pending', 'la expectativa desvinculada vuelve a esperar', `${t2AfterUnlink.status}`);

  // ---------- el switch del sistema ----------
  const parked = await request('PUT', '/settings/disputes.enabled', { value: false });
  const parkedRun = await request('POST', '/disputes/run');
  check(parked.status === 200 && parkedRun.status === 409, 'con el motor apagado la corrida manual da 409', `${parkedRun.status}`);
  await request('PUT', '/settings/disputes.enabled', { value: true });

  const enabledRun = await request('POST', '/disputes/run');
  check(enabledRun.status === 201, 'al reactivarlo vuelve a correr', `${enabledRun.status}`);

  // ---------- rebuild: se lleva lo automatico y respeta lo manual ----------
  const t2Relinked = await linkOf(t2First.id);
  check(t2Relinked?.link?.matchedBy === 'declared', 'el rebuild previo dejo el link automatico de nuevo', `${t2Relinked?.link?.matchedBy}`);

  const rebuild = await request('POST', '/disputes/rebuild');
  const t7LinkAfter = await linkOf(t7First.id);
  const t5LinkAfter = await linkOf(t5First.id);
  check(rebuild.status === 201, 'rebuild responde', `${rebuild.status}`);
  check(Number(rebuild.body?.links) > 0, 'rebuild borra los links automaticos', `${rebuild.body?.links}`);
  check(t7LinkAfter?.link?.matchedBy === 'manual', 'el link manual sobrevive al rebuild', `${t7LinkAfter?.link?.matchedBy}`);
  check(t5LinkAfter?.link?.matchedBy === 'manual', 'la respuesta de la consulta sobrevive al rebuild', `${t5LinkAfter?.link?.matchedBy}`);

  // ---------- validaciones de frontera ----------
  // Despues del rebuild la disputa vieja ya no existe: se usa la que el pase volvio a abrir.
  const freshUnplanned = (await disputesOf()).find(
    (d) => d.movementId === unplannedMovement.body.id && d.status === 'open',
  );
  const badResolution = await request('POST', `/disputes/${freshUnplanned?.id}/resolve`, { resolution: 'paid_late' });
  check(badResolution.status === 400, 'una resolucion que no aplica al tipo da 400', `${badResolution.status}`);

  const badCategory = await request('PUT', `/tasks/${t6.body.id}/category-links`, { categoryIds: ['00000000-0000-4000-8000-000000000000'] });
  check(badCategory.status === 404, 'una categoria inexistente da 404', `${badCategory.status}`);

  const declared = (await request('GET', `/tasks/${t6.body.id}/category-links`)).body;
  check(Array.isArray(declared) && declared.length === 1, 'la declaracion se lee de vuelta', `${declared?.length}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nDISPUTAS EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
