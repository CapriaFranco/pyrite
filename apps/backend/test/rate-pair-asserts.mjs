import { createRequire } from 'module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { resolveRate } = require(resolve(here, '../dist/src/bll/rates/rate-pair.js'));

/** Aserciones de la resolucion de pares (spec 027): utilidad pura, series de prueba. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const point = (type, base, quote, buy, sell, date = '2026-09-20') => ({ type, base, quote, buy, sell, date });

// ---------- directo ----------
const blue = [point('blue', 'USD', 'ARS', 1000, 1050)];
const direct = resolveRate(blue, 'USD', 'ARS');
check(direct?.kind === 'direct', 'el par directo se resuelve como directo', direct?.kind);
check(direct?.buy === 1000 && direct?.sell === 1050, 'el directo trae los dos lados exactos', `${direct?.buy}/${direct?.sell}`);
check(direct?.rate === 1025, 'el rate de referencia es el medio', `${direct?.rate}`);
check(direct?.used.length === 1, 'deja registrada la cotizacion usada', `${direct?.used.length}`);

// ---------- inverso ----------
const inverse = resolveRate(blue, 'ARS', 'USD');
check(inverse?.kind === 'inverse', 'el par opuesto se resuelve como inverso', inverse?.kind);
check(Number(inverse?.rate.toFixed(6)) === Number((1 / 1025).toFixed(6)), 'el inverso es uno sobre el medio', `${inverse?.rate}`);
check(inverse?.buy === undefined && inverse?.sell === undefined, 'en el inverso no inventa lados que no existen');

// ---------- mismo par ----------
const same = resolveRate(blue, 'ARS', 'ARS');
check(same?.kind === 'direct' && same.rate === 1, 'convertir a la misma moneda es uno');

// ---------- compuesto por la moneda base ----------
const twoPairs = [point('blue', 'USD', 'ARS', 1000, 1050), point('eur_oficial', 'EUR', 'ARS', 1100, 1150)];
const cross = resolveRate(twoPairs, 'EUR', 'USD', 'ARS');
check(cross?.kind === 'cross', 'un par sin cotizacion propia se arma por la moneda base', cross?.kind);
check(Number(cross?.rate.toFixed(6)) === Number((1125 / 1025).toFixed(6)), 'el compuesto multiplica los medios de cada tramo', `${cross?.rate}`);
check(cross?.used.length === 2, 'deja las dos cotizaciones usadas', `${cross?.used.length}`);
check(cross?.buy === undefined && cross?.sell === undefined, 'en el compuesto tampoco inventa lados');

const crossInverse = resolveRate(twoPairs, 'USD', 'EUR', 'ARS');
check(crossInverse?.kind === 'cross', 'el compuesto tambien funciona al reves', crossInverse?.kind);
check(Number(crossInverse?.rate.toFixed(6)) === Number((1 / (1125 / 1025)).toFixed(6)), 'y es el inverso del de ida', `${crossInverse?.rate}`);

// ---------- sin camino ----------
check(resolveRate(blue, 'EUR', 'USD', 'ARS') === null, 'sin camino no inventa un rate');
check(resolveRate([], 'USD', 'ARS') === null, 'sin series tampoco');

// ---------- eleccion de cotizacion ----------
const many = [point('blue', 'USD', 'ARS', 1000, 1050), point('oficial', 'USD', 'ARS', 800, 850)];
const chosen = resolveRate(many, 'USD', 'ARS', 'ARS', 'oficial');
check(chosen?.rate === 825, 'con tipo pedido usa esa cotizacion', `${chosen?.rate}`);
const newest = resolveRate(
  [point('blue', 'USD', 'ARS', 1000, 1050, '2026-09-01'), point('blue', 'USD', 'ARS', 2000, 2050, '2026-09-20')],
  'USD',
  'ARS',
  'ARS',
  'blue',
);
check(newest?.rate === 2025, 'entre varias fechas toma la mas nueva', `${newest?.rate}`);

console.log(failures === 0 ? '\nPARES DE COTIZACION EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
