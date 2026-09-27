import { createRequire } from 'module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
  STALE_DAYS_KEY,
  DEFAULT_STALE_DAYS,
  MIN_STALE_DAYS,
  MAX_STALE_DAYS,
  ageInDays,
  isStale,
  parseStaleDays,
} = require(resolve(here, '../dist/src/bll/counts/credential-age.js'));

/** Aserciones de la edad de una credencial (spec 028): calculo puro con fechas fijas. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const at = (iso) => new Date(iso);
const base = at('2026-06-15T10:00:00Z');

// ---------- dias enteros ----------
check(ageInDays(base, at('2026-06-15T10:00:00Z')) === 0, 'el mismo instante son cero dias');
check(ageInDays(base, at('2026-06-14T10:00:00Z')) === 1, 'un dia antes es un dia');
check(ageInDays(base, at('2026-05-17T10:00:00Z')) === 29, 'veintinueve dias');
check(ageInDays(base, at('2026-05-16T10:00:00Z')) === 30, 'treinta dias');
check(ageInDays(base, at('2026-05-15T10:00:00Z')) === 31, 'treinta y un dias');

// ---------- bisiesto ----------
check(ageInDays(at('2024-03-01T00:00:00Z'), at('2024-02-28T00:00:00Z')) === 2, 'el 29 de febrero suma un dia');
check(ageInDays(at('2025-03-01T00:00:00Z'), at('2025-02-28T00:00:00Z')) === 1, 'sin bisiesto el mismo tramo es un dia');

// ---------- fracciones ----------
check(ageInDays(base, at('2026-06-14T23:30:00Z')) === 0, 'una fraccion de dia no cuenta como un dia');
check(ageInDays(base, at('2026-06-13T11:00:00Z')) === 1, 'un dia y una hora sigue siendo un dia');

// ---------- la hora del dia no mueve el numero ----------
const morning = [at('2026-06-15T10:00:00Z'), at('2026-06-10T10:00:00Z')];
const night = [at('2026-06-15T23:59:00Z'), at('2026-06-10T23:59:00Z')];
check(ageInDays(morning[0], morning[1]) === 5, 'cinco dias a la manana');
check(ageInDays(night[0], night[1]) === 5, 'los mismos cinco a la noche');

// ---------- sin fecha ----------
check(ageInDays(base, null) === null, 'sin fecha no hay edad');
check(isStale(null, 90) === false, 'sin fecha nunca es rancia');
check(isStale(null, 0) === false, 'sin fecha tampoco con el recordatorio apagado');

// ---------- el umbral ----------
check(isStale(90, 90) === true, 'justo en el umbral cuenta como rancia');
check(isStale(89, 90) === false, 'un dia por debajo del umbral no');
check(isStale(91, 90) === true, 'por encima tampoco queda en duda');
check(isStale(0, 90) === false, 'una credencial de hoy no es rancia');

// ---------- el cero apaga ----------
const everything = [0, 1, 29, 89, 90, 3650, 100000];
check(everything.every((age) => isStale(age, 0) === false), 'con el umbral en cero ninguna edad es rancia');

// ---------- parseStaleDays ----------
check(parseStaleDays(0) === 0, 'el cero es un valor valido, nunca ausente');
check(parseStaleDays(90) === 90, 'acepta el default');
check(parseStaleDays(3650) === 3650, 'acepta el maximo');
check(parseStaleDays('90') === 90, 'acepta el mismo numero escrito como texto');
check(parseStaleDays(-1) === null, 'rechaza un negativo');
check(parseStaleDays(1.5) === null, 'rechaza una fraccion');
check(parseStaleDays('180x') === null, 'rechaza un texto que no es un numero');
check(parseStaleDays(null) === null, 'rechaza null');
check(parseStaleDays({}) === null, 'rechaza un objeto');
check(parseStaleDays('') === null, 'rechaza el texto vacio');
check(parseStaleDays(undefined) === null, 'rechaza la ausencia de valor');
check(parseStaleDays(3651) === null, 'rechaza un valor por encima del maximo');

// ---------- las constantes de la spec 012 ----------
check(STALE_DAYS_KEY === 'counts.stale_days', 'la clave es la que nombro la spec 012', STALE_DAYS_KEY);
check(DEFAULT_STALE_DAYS === 90, 'el default es un trimestre', `${DEFAULT_STALE_DAYS}`);
check(MIN_STALE_DAYS === 0 && MAX_STALE_DAYS === 3650, 'el rango es 0..3650', `${MIN_STALE_DAYS}..${MAX_STALE_DAYS}`);

console.log(failures === 0 ? '\nEDAD DE CREDENCIALES EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
