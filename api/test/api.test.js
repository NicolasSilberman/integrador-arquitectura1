// Pruebas de integración del sistema de expensas. Cada bloque verifica una decisión de arquitectura o un NFR
// (consistencia, idempotencia, seguridad, resiliencia): el documento de arquitectura referencia estos nombres.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararEntorno } from './entorno.js';

let e;                   // entorno
let paula, pablo, adriana;   // tokens
const FECHA = '2020-03-15';  // día de cobranzas usado en las pruebas (siempre en el pasado)

before(async () => {
  e = await prepararEntorno();
  paula = await e.firmar('paula', ['propietario']);
  pablo = await e.firmar('pablo', ['propietario']);
  adriana = await e.firmar('adriana', ['administrador']);
});
after(async () => { await e?.apagar(); });

const expensasDe = async (token) => (await e.llamar('GET', '/v1/expensas?periodo=2026-10', { token })).cuerpo;

describe('Seguridad: autenticación (401) y autorización (403)', () => {
  test('sin token -> 401 con Problem Details y WWW-Authenticate', async () => {
    const r = await e.llamar('GET', '/v1/expensas');
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type'), /application\/problem\+json/);
    assert.match(r.headers.get('www-authenticate'), /Bearer/);
    assert.equal(r.cuerpo.status, 401);
  });

  test('token con firma ajena -> 401', async () => {
    const { privateKey } = await e.generarClave();
    const falso = await e.firmar('paula', ['propietario'], { clave: privateKey });
    const r = await e.llamar('GET', '/v1/expensas', { token: falso });
    assert.equal(r.status, 401);
    assert.match(r.cuerpo.detail, /SIGNATURE/);
  });

  test('token con el payload alterado (roles editados a mano) -> 401', async () => {
    const [h, , firma] = paula.split('.');
    const payload = Buffer.from(JSON.stringify({ preferred_username: 'paula', realm_access: { roles: ['administrador'] } })).toString('base64url');
    const r = await e.llamar('GET', '/v1/conciliaciones', { token: `${h}.${payload}.${firma}` });
    assert.equal(r.status, 401);
  });

  test('token vencido -> 401', async () => {
    const vencido = await e.firmar('paula', ['propietario'], { expiraEn: Math.floor(Date.now() / 1000) - 60 });
    assert.equal((await e.llamar('GET', '/v1/expensas', { token: vencido })).status, 401);
  });

  test('token para otra audiencia -> 401', async () => {
    const otro = await e.firmar('paula', ['propietario'], { audiencia: 'otra-api' });
    assert.equal((await e.llamar('GET', '/v1/expensas', { token: otro })).status, 401);
  });

  test('token de otro emisor -> 401', async () => {
    const otro = await e.firmar('paula', ['propietario'], { emisor: 'http://otro.idp/realms/x' });
    assert.equal((await e.llamar('GET', '/v1/expensas', { token: otro })).status, 401);
  });

  test('un propietario no puede conciliar ni ver cobranzas -> 403', async () => {
    assert.equal((await e.llamar('POST', '/v1/conciliaciones', { token: paula, cuerpo: { fecha: FECHA } })).status, 403);
    assert.equal((await e.llamar('GET', '/v1/cobranzas', { token: paula })).status, 403);
  });

  test('un administrador no puede generar códigos de pago -> 403', async () => {
    const lista = await expensasDe(adriana);
    const r = await e.llamar('PUT', `/v1/expensas/${lista[0].id}/codigo-pago`, { token: adriana });
    assert.equal(r.status, 403);
  });

  test('/health es público', async () => {
    assert.equal((await e.llamar('GET', '/health')).status, 200);
  });

  test('Keycloak caído: los tokens firmados con claves ya conocidas SIGUEN funcionando (las claves están en caché)', async () => {
    assert.equal((await e.llamar('GET', '/v1/expensas', { token: paula })).status, 200);   // calienta la caché
    await e.idp.parar();
    try {
      assert.equal((await e.llamar('GET', '/v1/expensas', { token: paula })).status, 200);
    } finally {
      await e.idp.arrancar();
    }
  });

  test('Keycloak caído y la API recién arrancada (sin claves) -> 503 "identidad no disponible", no 401', async () => {
    e.idp.vaciarCacheDeClaves();
    await e.idp.parar();
    try {
      const r = await e.llamar('GET', '/v1/expensas', { token: paula });
      assert.equal(r.status, 503);
      assert.match(r.cuerpo.type, /identidad-no-disponible/);
    } finally {
      await e.idp.arrancar();
      e.idp.vaciarCacheDeClaves();
    }
    assert.equal((await e.llamar('GET', '/v1/expensas', { token: paula })).status, 200);   // se recupera sola
  });
});

describe('Propiedad de los datos: cada propietario ve solo lo suyo', () => {
  test('paula ve sus 2 unidades, pablo la suya y la administradora las 150', async () => {
    assert.equal((await expensasDe(paula)).length, 2);
    assert.equal((await expensasDe(pablo)).length, 1);
    assert.equal((await expensasDe(adriana)).length, 150);
  });

  test('pedir la expensa de otro propietario -> 403', async () => {
    const deSusUnidades = await expensasDe(pablo);
    const r = await e.llamar('GET', `/v1/expensas/${deSusUnidades[0].id}`, { token: paula });
    assert.equal(r.status, 403);
    const intento = await e.llamar('PUT', `/v1/expensas/${deSusUnidades[0].id}/codigo-pago`, { token: paula });
    assert.equal(intento.status, 403);
  });

  test('invariante: el total de cada expensa es exactamente la suma de sus conceptos', async () => {
    for (const resumen of await expensasDe(adriana)) {
      const d = await e.llamar('GET', `/v1/expensas/${resumen.id}`, { token: adriana });
      const suma = d.cuerpo.conceptos.reduce((acc, c) => acc + c.monto.centavos, 0);
      assert.equal(d.cuerpo.total.centavos, suma, `expensa ${resumen.id}`);
    }
  });

  test('parámetros inválidos -> 400 con Problem Details; id inexistente -> 404', async () => {
    assert.equal((await e.llamar('GET', '/v1/expensas?periodo=octubre', { token: paula })).status, 400);
    assert.equal((await e.llamar('GET', '/v1/expensas/abc', { token: paula })).status, 400);
    const r = await e.llamar('GET', '/v1/expensas/999999', { token: paula });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /problem\+json/);
  });
});

describe('Caso de uso: ver la liquidación, pagarla y que el pago quede imputado', () => {
  let expensa, codigo;

  test('el propietario genera su código de pago: 201 la primera vez, 200 (el mismo código) al repetir', async () => {
    expensa = (await expensasDe(paula))[0];
    const primera = await e.llamar('PUT', `/v1/expensas/${expensa.id}/codigo-pago`, { token: paula });
    assert.equal(primera.status, 201);
    assert.match(primera.headers.get('location'), new RegExp(`/v1/expensas/${expensa.id}/codigo-pago`));
    assert.match(primera.cuerpo.codigoPago, /^\d{11}$/);
    codigo = primera.cuerpo.codigoPago;
    const repetida = await e.llamar('PUT', `/v1/expensas/${expensa.id}/codigo-pago`, { token: paula });
    assert.equal(repetida.status, 200);
    assert.equal(repetida.cuerpo.codigoPago, codigo);
    assert.equal((await e.llamar('GET', `/v1/expensas/${expensa.id}/codigo-pago`, { token: paula })).cuerpo.codigoPago, codigo);
  });

  test('antes de conciliar la expensa sigue EMITIDA', async () => {
    const d = await e.llamar('GET', `/v1/expensas/${expensa.id}`, { token: paula });
    assert.equal(d.cuerpo.estado, 'EMITIDA');
    assert.equal(d.cuerpo.pago, null);
  });

  test('paga en el banco, la conciliación descarga el listado por SOAP y la expensa queda PAGADA e imputada', async () => {
    await e.pagarEnBanco(codigo, expensa.total.centavos, FECHA);
    const c = await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: FECHA } });
    assert.equal(c.status, 201);
    assert.match(c.headers.get('location'), /\/v1\/conciliaciones\/\d+/);
    assert.deepEqual([c.cuerpo.estado, c.cuerpo.leidas, c.cuerpo.imputadas, c.cuerpo.observadas, c.cuerpo.yaProcesadas], ['OK', 1, 1, 0, 0]);
    const d = await e.llamar('GET', `/v1/expensas/${expensa.id}`, { token: paula });
    assert.equal(d.cuerpo.estado, 'PAGADA');
    assert.equal(d.cuerpo.pago.monto.centavos, expensa.total.centavos);
    assert.equal(d.cuerpo.pago.fechaPago, FECHA);
  });

  test('una expensa ya pagada no admite nuevo código de pago -> 409', async () => {
    const r = await e.llamar('PUT', `/v1/expensas/${expensa.id}/codigo-pago`, { token: paula });
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.type, /expensa-ya-pagada/);
  });
});

describe('Consistencia: nunca se cobra dos veces la misma expensa (NFR estrella)', () => {
  test('re-ejecutar la conciliación del mismo día no imputa nada de nuevo (idempotencia)', async () => {
    const antes = await e.consultaDirecta.query(`SELECT count(*)::int AS n FROM cobranzas WHERE estado = 'IMPUTADA'`);
    const c = await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: FECHA } });
    assert.equal(c.status, 201);
    assert.deepEqual([c.cuerpo.leidas, c.cuerpo.imputadas, c.cuerpo.yaProcesadas], [1, 0, 1]);
    const despues = await e.consultaDirecta.query(`SELECT count(*)::int AS n FROM cobranzas WHERE estado = 'IMPUTADA'`);
    assert.equal(despues.rows[0].n, antes.rows[0].n);
  });

  test('si el propietario paga DOS veces en el banco, el segundo pago queda OBSERVADO y no se imputa', async () => {
    const expensa = (await expensasDe(pablo))[0];
    const { cuerpo: { codigoPago } } = await e.llamar('PUT', `/v1/expensas/${expensa.id}/codigo-pago`, { token: pablo });
    const dia = '2020-03-16';
    await e.pagarEnBanco(codigoPago, expensa.total.centavos, dia);
    await e.pagarEnBanco(codigoPago, expensa.total.centavos, dia);     // operación distinta, mismo código
    const c = await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: dia } });
    assert.deepEqual([c.cuerpo.leidas, c.cuerpo.imputadas, c.cuerpo.observadas], [2, 1, 1]);
    const observadas = await e.llamar('GET', '/v1/cobranzas?estado=OBSERVADA', { token: adriana });
    assert.ok(observadas.cuerpo.some((o) => o.motivo === 'PAGO_DUPLICADO' && o.expensaId === expensa.id));
    const n = await e.consultaDirecta.query(`SELECT count(*)::int AS n FROM cobranzas WHERE expensa_id = $1 AND estado = 'IMPUTADA'`, [expensa.id]);
    assert.equal(n.rows[0].n, 1);
  });

  test('importe distinto al de la expensa -> OBSERVADA (MONTO_DISTINTO); código inexistente -> OBSERVADA (CODIGO_DESCONOCIDO)', async () => {
    const lista = await expensasDe(adriana);
    const sinPagar = lista.find((x) => x.estado === 'EMITIDA' && x.unidad.consorcio.id === 4);
    const { codigoPago } = (await e.llamar('PUT', `/v1/expensas/${sinPagar.id}/codigo-pago`, { token: await e.firmar(sinPagar.unidad.codigo, ['propietario']) })).cuerpo ?? {};
    // el usuario inventado no es dueño: el código lo generamos desde la base de datos para aislar esta prueba
    const codigo = codigoPago ?? (await e.consultaDirecta.query(`UPDATE expensas SET codigo_pago = '00000000009' WHERE id = $1 RETURNING codigo_pago`, [sinPagar.id])).rows[0].codigo_pago;
    const dia = '2020-03-17';
    await e.pagarEnBanco(codigo, sinPagar.total.centavos - 100, dia);
    await e.pagarEnBanco('99999999999', 12345, dia);
    const c = await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: dia } });
    assert.deepEqual([c.cuerpo.imputadas, c.cuerpo.observadas], [0, 2]);
    const detalle = await e.llamar('GET', `/v1/conciliaciones/${c.cuerpo.id}`, { token: adriana });
    assert.deepEqual(detalle.cuerpo.cobranzas.map((x) => x.motivo).sort(), ['CODIGO_DESCONOCIDO', 'MONTO_DISTINTO']);
    assert.equal((await expensasDe(adriana)).find((x) => x.id === sinPagar.id).estado, 'EMITIDA');
  });

  test('CONCURRENCIA: 6 conciliaciones simultáneas del mismo día imputan UNA sola vez', async () => {
    const lista = await expensasDe(adriana);
    const objetivo = lista.filter((x) => x.estado === 'EMITIDA' && x.unidad.consorcio.id === 5)[0];
    await e.consultaDirecta.query(`UPDATE expensas SET codigo_pago = '00000000017' WHERE id = $1`, [objetivo.id]);
    const dia = '2020-03-18';
    await e.pagarEnBanco('00000000017', objetivo.total.centavos, dia);
    const resultados = await Promise.all(Array.from({ length: 6 }, () => e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: dia } })));
    for (const r of resultados) assert.ok([201, 409].includes(r.status), `estado inesperado ${r.status}`);
    assert.ok(resultados.some((r) => r.status === 201));
    const n = await e.consultaDirecta.query(`SELECT count(*)::int AS n FROM cobranzas WHERE expensa_id = $1 AND estado = 'IMPUTADA'`, [objetivo.id]);
    assert.equal(n.rows[0].n, 1);
  });

  test('la base impide por sí sola dos imputaciones de la misma expensa (índice único parcial)', async () => {
    const { rows: [corrida] } = await e.consultaDirecta.query('SELECT id FROM conciliaciones LIMIT 1');
    const { rows: [pagada] } = await e.consultaDirecta.query(`SELECT expensa_id FROM cobranzas WHERE estado = 'IMPUTADA' LIMIT 1`);
    await assert.rejects(
      e.consultaDirecta.query(
        `INSERT INTO cobranzas (banco_ref, conciliacion_id, codigo_pago, monto_centavos, fecha_pago, estado, expensa_id)
         VALUES ('trampa-1', $1, 'x', 1, '2020-01-01', 'IMPUTADA', $2)`, [corrida.id, pagada.expensa_id]),
      /una_imputacion_por_expensa/);
  });
});

describe('Resiliencia: el banco falla y nadie está de guardia', () => {
  test('banco caído -> 502 con Problem Details, la corrida queda ERROR y reintentar después funciona', async () => {
    const dia = '2020-03-19';
    await e.bancoFalla(true);
    const falla = await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: dia } });
    assert.equal(falla.status, 502);
    assert.match(falla.cuerpo.type, /banco-no-disponible/);
    assert.ok(falla.cuerpo.conciliacionId);
    const registrada = await e.llamar('GET', `/v1/conciliaciones/${falla.cuerpo.conciliacionId}`, { token: adriana });
    assert.equal(registrada.cuerpo.estado, 'ERROR');
    await e.bancoFalla(false);
    const ok = await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: dia } });
    assert.equal(ok.status, 201);
    assert.equal(ok.cuerpo.estado, 'OK');
  });

  test('fecha futura o inválida -> 422 / 400', async () => {
    assert.equal((await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: '2999-01-01' } })).status, 422);
    assert.equal((await e.llamar('POST', '/v1/conciliaciones', { token: adriana, cuerpo: { fecha: '2026-02-31' } })).status, 400);
  });

  test('una corrida que quedó EN_CURSO por un reinicio se marca como ERROR (interrumpida) al arrancar', async () => {
    const { marcarInterrumpidas } = await import('../src/modulos/cobranzas/index.js');
    const { rows: [corrida] } = await e.consultaDirecta.query(
      `INSERT INTO conciliaciones (fecha_cobranzas, origen, estado) VALUES ('2020-01-01', 'AUTOMATICA', 'EN_CURSO') RETURNING id`);
    assert.equal(await marcarInterrumpidas(), 1);
    const { rows: [despues] } = await e.consultaDirecta.query('SELECT estado, error FROM conciliaciones WHERE id = $1', [corrida.id]);
    assert.equal(despues.estado, 'ERROR');
    assert.match(despues.error, /Interrumpida/);
  });

  // El planificador recibe "qué hora es" como parámetro (fecha y hora de pared); el tiempo de espera entre reintentos
  // se mide con el reloj de la base, así que en la prueba se "envejece" el último intento con un UPDATE.
  test('planificador automático: no corre antes de la hora configurada (07:00)', async () => {
    const { ejecutarCiclo } = await import('../src/scheduler.js');
    const seisAm = new Date('2020-06-10T09:00:00Z');                  // 06:00 en Buenos Aires (UTC-3)
    assert.deepEqual((await ejecutarCiclo(seisAm)).ejecutadas, []);
  });

  test('planificador automático: se pone al día solo (con tope de días), y si el banco falla reintenta después', async () => {
    const { ejecutarCiclo } = await import('../src/scheduler.js');
    const ocho = new Date('2020-06-10T11:00:00Z');                    // 08:00 en Buenos Aires -> "ayer" = 2020-06-09

    await e.bancoFalla(true);
    const conFalla = await ejecutarCiclo(ocho);
    assert.deepEqual(conFalla.ejecutadas, [{ dia: '2020-06-03', resultado: 'ERROR' }]);   // falla el día más viejo y se detiene
    assert.deepEqual((await ejecutarCiclo(ocho)).ejecutadas, []);                         // recién falló: espera antes de reintentar

    await e.bancoFalla(false);
    await e.consultaDirecta.query(`UPDATE conciliaciones SET iniciada_en = iniciada_en - interval '40 minutes' WHERE fecha_cobranzas = '2020-06-03'`);
    const despues = await ejecutarCiclo(ocho);
    assert.equal(despues.ejecutadas.length, 7);                                           // tope: 7 días hacia atrás
    assert.ok(despues.ejecutadas.every((x) => x.resultado === 'OK'));
    assert.equal(despues.ejecutadas.at(-1).dia, '2020-06-09');

    assert.deepEqual((await ejecutarCiclo(ocho)).ejecutadas, []);                         // al día: nada pendiente
  });
});
