import { createRequire } from 'module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
  mapDollarRows,
  mapCurrencyRows,
  INGESTED_CURRENCIES,
  PROVIDER_PAIR,
  WATCHED_FEEDS,
  staleFeedWarning,
} = require(resolve(here, '../dist/src/bll/rates/rates-sources.js'));

/** Aserciones de las fuentes de cotizaciones (spec 030): mapeo puro, filas de prueba. */
let failures = 0;
const check = (ok, name, extra = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
};

const dollarRow = (casa, compra, venta, fecha = '2026-09-20') => ({ casa, compra, venta, fecha });
const currencyRow = (moneda, compra, venta, fecha = '2026-09-27', casa = 'oficial') => ({
  moneda,
  casa,
  compra,
  venta,
  fecha,
});

// ---------- el dolar, como estaba ----------
const dollars = mapDollarRows([dollarRow('blue', 1500, 1560), dollarRow('oficial', 1400, 1450)], '2025-01-01');
check(dollars.length === 2, 'el mapeo del dolar trae todas las casas', `${dollars.length}`);
check(dollars[0].type === 'blue' && dollars[0].buy === 1500 && dollars[0].sell === 1560, 'con el tipo y los lados de la fila');
check(dollars[0].base === 'USD' && dollars[0].quote === 'ARS', 'y el par del proveedor', `${dollars[0].base}/${dollars[0].quote}`);
check(dollars[0].date === '2026-09-20', 'y su fecha', dollars[0].date);
check(mapDollarRows([dollarRow('blue', null, 1560)], '2025-01-01').length === 0, 'una fila sin un lado no entra');
check(mapDollarRows([dollarRow('blue', 1500, null)], '2025-01-01').length === 0, 'sin venta tampoco');
check(mapDollarRows([dollarRow('', 1500, 1560)], '2025-01-01').length === 0, 'sin casa tampoco');
check(mapDollarRows([dollarRow('blue', 1500, 1560, '2024-12-31')], '2025-01-01').length === 0, 'ni una anterior a fromDate');

// ---------- el euro ----------
const currencies = mapCurrencyRows([currencyRow('EUR', 1725.777, 1739.8328), currencyRow('USD', 1400, 1450)], '2025-01-01');
check(currencies.length === 1, 'del payload de monedas solo entra lo declarado', `${currencies.length}`);
check(currencies[0].base === 'EUR' && currencies[0].quote === 'ARS', 'el euro se escribe con su par', `${currencies[0].base}/${currencies[0].quote}`);
check(currencies[0].type === 'oficial', 'con el nombre que le da la fuente', currencies[0].type);
check(currencies[0].buy === 1725.777 && currencies[0].sell === 1739.8328, 'y los valores de la fila tal como llegan', `${currencies[0].buy}/${currencies[0].sell}`);
check(currencies[0].date === '2026-09-27', 'con su fecha', currencies[0].date);

const withoutCasa = { moneda: 'EUR', compra: 1068.6165, venta: 1074.312, fecha: '2023-10-22' };
const named = mapCurrencyRows([withoutCasa], '2023-01-01');
check(named.length === 1 && named[0].type === 'oficial', 'una fila sin casa toma la unica cotizacion de la serie', named[0]?.type);
check(mapCurrencyRows([currencyRow('EUR', null, 1739.8328)], '2025-01-01').length === 0, 'una fila sin compra no entra');
check(mapCurrencyRows([currencyRow('EUR', 1725.777, null)], '2025-01-01').length === 0, 'sin venta tampoco');
check(mapCurrencyRows([currencyRow('EUR', 1725.777, 1739.8328, '2024-12-31')], '2025-01-01').length === 0, 'ni una anterior a fromDate');

// El dolar de este endpoint no se ingiere: ya tiene su proveedor con ocho casas.
check(mapCurrencyRows([currencyRow('USD', 1400, 1450)], '2025-01-01').length === 0, 'y las filas del dolar del mismo payload se descartan');

// ---------- sumar una moneda es declararla ----------
// BRL todavia no es codigo del catalogo (spec 026), asi que no se declara; el fixture muestra el costo de sumarla.
const twoCurrencies = mapCurrencyRows(
  [currencyRow('EUR', 1725.777, 1739.8328), currencyRow('BRL', 250, 260)],
  '2025-01-01',
  ['EUR', 'BRL'],
);
check(twoCurrencies.length === 2, 'dos monedas declaradas producen dos cotizaciones', `${twoCurrencies.length}`);
check(twoCurrencies[1].base === 'BRL' && twoCurrencies[1].quote === 'ARS', 'cada una con su par', `${twoCurrencies[1].base}/${twoCurrencies[1].quote}`);
check(twoCurrencies[1].type === 'oficial' && twoCurrencies[1].buy === 250, 'y el mismo mapeo, sin reglas por moneda');
check(INGESTED_CURRENCIES.length === 1 && INGESTED_CURRENCIES[0] === 'EUR', 'hoy la unica moneda declarada es el euro', INGESTED_CURRENCIES.join(','));
check(PROVIDER_PAIR.base === 'USD' && PROVIDER_PAIR.quote === 'ARS', 'y el par del proveedor sigue siendo el dolar contra el peso');

// ---------- el chequeo diario por serie ----------
check(WATCHED_FEEDS.length === 2, 'el chequeo diario mira dos series', `${WATCHED_FEEDS.length}`);
const euro = WATCHED_FEEDS.find((feed) => feed.name === 'euro');
check(euro?.type === 'oficial' && euro.base === 'EUR' && euro.quote === 'ARS', 'y una de ellas es el euro');

const now = Date.parse('2026-09-28T00:00:00Z');
check(staleFeedWarning(euro, '2026-09-27', now) === null, 'una serie al dia no avisa');
const behind = staleFeedWarning(euro, '2026-09-20', now);
check(behind?.includes('euro') === true && behind?.includes('2026-09-20') === true, 'una atrasada avisa con su nombre y su ultima fecha', behind);
check(staleFeedWarning(euro, undefined, now)?.includes('euro') === true, 'y una serie sin datos tambien avisa');

console.log(failures === 0 ? '\nFUENTES DE COTIZACIONES EN VERDE' : `\n${failures} chequeo(s) fallan`);
process.exit(failures === 0 ? 0 : 1);
