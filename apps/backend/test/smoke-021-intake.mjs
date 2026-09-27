import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { fileURLToPath } from 'url';

/** El backend compilado vive un nivel arriba, sin importar desde donde se corra. */
const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 30093;
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
const settings = (key, value) => request('PUT', `/settings/${key}`, { value });
const category = async (name, isService = false) =>
  (await request('POST', '/finances/categories', { name, type: 'expense', isService })).body;
const movement = (categoryId, description, amount, dateOffset, note) =>
  request('POST', '/finances/movements', {
    type: 'expense', amountCurrency: 'USD', amount, paidCurrency: 'USD', paidAmount: amount,
    currencyCode: 'USD', walletType: 'digital', categoryId, description, note: note ?? null,
    date: new Date(`${day(dateOffset)}T09:00:00Z`),
  });
const paymentTask = (title, startsOn, groupId = null) =>
  request('POST', '/tasks', {
    title,
    type: 'pago',
    startsOn,
    groupId,
    recurrence: monthly,
    payment: { mode: 'recurrente', priceFixed: true, priceAmount: '20.00', priceCurrency: 'USD' },
  });
const declare = (taskId, categoryId) => request('PUT', `/tasks/${taskId}/category-links`, { categoryIds: [categoryId] });
const expectationsOf = async (taskId) => (await request('GET', `/tasks/${taskId}/expectations`)).body ?? [];


try {
  check(await waitForHealth(), 'el backend arranca');
  if (failures > 0) throw new Error(serverLog.slice(-800));

  // ---------- el grupo de sistema existe y no se toca ----------
  const systemGroups = (await request('GET', '/tasks/groups/system')).body ?? [];
  const finances = systemGroups.find((g) => g.name === 'finances');
  check(systemGroups.length >= 1 && finances?.isSystem === true, 'finances/ existe y esta marcado como sistema');
  const renameSystem = await request('PUT', `/tasks/groups/${finances?.id}`, { name: 'otro' });
  const deleteSystem = await request('DELETE', `/tasks/groups/${finances?.id}`);
  check(renameSystem.status === 400, 'el grupo de sistema no se renombra', `${renameSystem.status}`);
  check(deleteSystem.status === 400, 'el grupo de sistema no se borra', `${deleteSystem.status}`);

  // ---------- una compra comun no pregunta nada ----------
  const plain = await category(`intake-plain-${stamp}`);
  const plainMovement = await movement(plain.id, `Supermercado ${stamp}`, 15000, 0);
  check(plainMovement.body?.intake?.kind === 'none', 'una compra comun no genera pregunta', `${plainMovement.body?.intake?.kind}`);

  // ---------- categoria declarada con expectativa en ventana: vincula sola ----------
  const c1 = await category(`intake-link-${stamp}`);
  const t1 = await paymentTask(`Servicio ${stamp}`, day(-1));
  await declare(t1.body.id, c1.id);
  const linked = await movement(c1.id, `Servicio ${stamp} pago`, 20, -1);
  check(linked.body?.intake?.kind === 'linked', 'un movimiento esperado se vincula al guardarse', `${linked.body?.intake?.kind}`);
  check(linked.body?.intake?.autoLinked === true, 'la respuesta avisa que fue automatico');
  const t1First = (await expectationsOf(t1.body.id))[0];
  check(t1First?.status === 'settled', 'la expectativa queda conciliada', `${t1First?.status}`);

  // ---------- categoria declarada sin expectativa: pregunta por la task ----------
  const c2 = await category(`intake-existing-${stamp}`);
  const t2 = await paymentTask(`Servicio futuro ${stamp}`, day(20));
  await declare(t2.body.id, c2.id);
  const existing = await movement(c2.id, `Cobro raro ${stamp}`, 20, 0);
  check(existing.body?.intake?.kind === 'existing_task', 'una task sin expectativa ahi se pregunta', `${existing.body?.intake?.kind}`);
  check(existing.body?.intake?.taskId === t2.body.id, 'la pregunta nombra la task que correspondia');

  // ---------- categoria de servicio sin task: ofrece crear ----------
  const c3 = await category(`intake-new-${stamp}`, true);
  const fresh = await movement(c3.id, `Nuevo servicio ${stamp}`, 25, 0, `alta ${stamp}`);
  check(fresh.body?.intake?.kind === 'new_task', 'una categoria de servicio sin task ofrece crear', `${fresh.body?.intake?.kind}`);
  const draft = fresh.body?.intake?.draft;
  check(draft?.title === `Nuevo servicio ${stamp}`, 'el borrador toma el titulo del movimiento', `${draft?.title}`);
  check(draft?.description === `alta ${stamp}`, 'la nota del movimiento pasa a descripcion');
  check(draft?.payment?.priceAmount === '25.00' && draft?.payment?.priceCurrency === 'USD', 'el monto viaja como precio estimado');
  check(draft?.groupId === finances?.id, 'el destino es el grupo de sistema', `${draft?.groupId}`);

  // ---------- confirmar el alta crea la task, la deja en finances/ y vincula ----------
  const confirmed = await request('POST', '/disputes/intake/confirm', {
    movementId: fresh.body.id,
    kind: 'new_task',
  });
  const created = (await request('GET', `/tasks/${confirmed.body?.taskId}`)).body;
  check(confirmed.body?.kind === 'linked', 'confirmar el alta termina vinculando', `${confirmed.body?.kind}`);
  check(created?.groupId === finances?.id, 'la task nueva vive en finances/', `${created?.groupId}`);
  check(created?.title === `Nuevo servicio ${stamp}`, 'el titulo sale del movimiento');
  const createdExpectations = await expectationsOf(confirmed.body?.taskId);
  check(
    createdExpectations.some((e) => e.status === 'settled'),
    'la serie nueva genero una expectativa y quedo conciliada',
  );
  const declared = (await request('GET', `/tasks/${confirmed.body?.taskId}/category-links`)).body ?? [];
  check(declared.includes(c3.id), 'la categoria queda declarada para el proximo cobro');

  // ---------- el proximo cobro de ese servicio se vincula solo ----------
  const secondCharge = await movement(c3.id, `Nuevo servicio ${stamp} mes 2`, 25, 30);
  check(secondCharge.body?.intake?.kind === 'linked', 'el segundo cobro ya se vincula solo', `${secondCharge.body?.intake?.kind}`);

  // ---------- descartar no vuelve a preguntar ----------
  const c4 = await category(`intake-dismiss-${stamp}`, true);
  const dismissible = await movement(c4.id, `Dudoso ${stamp}`, 30, 0);
  const dismissed = await request('POST', '/disputes/intake/dismiss', { movementId: dismissible.body.id });
  const askedAgain = (await request('GET', `/disputes/intake/${dismissible.body.id}`)).body;
  check(dismissed.body?.dismissed === true, 'descartar responde que si');
  check(askedAgain?.kind === 'none', 'descartado no se vuelve a preguntar', `${askedAgain?.kind}`);

  // ---------- confirmar una task existente vincula a su expectativa mas cercana ----------
  const c5 = await category(`intake-confirm-existing-${stamp}`);
  const t5 = await paymentTask(`Servicio cinco ${stamp}`, day(-40), null);
  await declare(t5.body.id, c5.id);
  const stray = await movement(c5.id, `Pago suelto ${stamp}`, 20, 0);
  const confirmExisting = await request('POST', '/disputes/intake/confirm', {
    movementId: stray.body.id,
    kind: 'existing_task',
    taskId: t5.body.id,
  });
  check(confirmExisting.body?.kind === 'linked', 'confirmar la task existente vincula', `${confirmExisting.body?.kind}`);
  check(Boolean(confirmExisting.body?.expectationId), 'la respuesta dice que expectativa se concilio');

  // ---------- el destino se puede rotar, y si no existe vuelve al de sistema ----------
  const custom = (await request('POST', '/tasks/groups', { name: `propio-${stamp}` })).body;
  await settings('tasks.finances_group_id', custom.id);
  const c6 = await category(`intake-dest-${stamp}`, true);
  const withCustom = await movement(c6.id, `Destino propio ${stamp}`, 40, 0);
  check(withCustom.body?.intake?.draft?.groupId === custom.id, 'el destino configurado se respeta', `${withCustom.body?.intake?.draft?.groupId}`);

  await settings('tasks.finances_group_id', '00000000-0000-4000-8000-0000000000ff');
  const c7 = await category(`intake-fallback-${stamp}`, true);
  const withFallback = await movement(c7.id, `Destino caido ${stamp}`, 40, 0);
  check(
    withFallback.body?.intake?.draft?.groupId === finances?.id,
    'un destino inexistente cae al grupo de sistema',
    `${withFallback.body?.intake?.draft?.groupId}`,
  );
  await settings('tasks.finances_group_id', null);

  // ---------- frontera: borrar el grupo de sistema sigue prohibido desde la ruta generica ----------
  const badDraft = await request('POST', '/disputes/intake/confirm', {
    movementId: withFallback.body.id,
    kind: 'new_task',
    draft: { groupId: 'no-es-uuid' },
  });
  check(badDraft.status === 201, 'un groupId invalido cae al de sistema', `${badDraft.status}`);
  const badKind = await request('POST', '/disputes/intake/confirm', { movementId: plainMovement.body.id, kind: 'raro' });
  check(badKind.status === 400, 'un kind invalido da 400', `${badKind.status}`);
  const badMovement = await request('POST', '/disputes/intake/dismiss', { movementId: 'nope' });
  check(badMovement.status === 400, 'un movimiento invalido da 400', `${badMovement.status}`);
} catch (error) {
  failures += 1;
  console.log(`ERROR  ${error.message}`);
} finally {
  child.kill();
  await sleep(400);
}

console.log(failures === 0 ? '\nINTAKE EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);

  check(Array.isArray(draft?.categoryIds) && draft.categoryIds[0] === c3.id, 'el borrador declara la categoria');
