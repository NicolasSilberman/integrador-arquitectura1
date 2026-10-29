// Test de CONTRATO: las respuestas reales de la API tienen que cumplir lo que promete openapi.yaml
// (esquemas de los cuerpos y códigos de estado documentados). Si alguien cambia el código sin cambiar el
// contrato —o al revés—, este test falla. Necesita las dependencias de desarrollo (npm install); si no están, se omite.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepararEntorno } from './entorno.js';

let Ajv2020, addFormats, YAML;
try {
  Ajv2020 = (await import('ajv/dist/2020.js')).default;
  addFormats = (await import('ajv-formats')).default;
  YAML = (await import('yaml')).default;
} catch { /* sin dependencias de desarrollo */ }

describe('Contrato OpenAPI vs implementación', { skip: !Ajv2020 && 'faltan las dependencias de desarrollo (npm install)' }, () => {
  let e, spec, ajv, tokens;
  const hallazgos = [];

  before(async () => {
    spec = YAML.parse(readFileSync(process.env.OPENAPI ?? new URL('../../openapi.yaml', import.meta.url), 'utf8'));
    ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema({ $id: 'oa', components: spec.components });
    e = await prepararEntorno();
    tokens = {
      paula: await e.firmar('paula', ['propietario']),
      pablo: await e.firmar('pablo', ['propietario']),
      adriana: await e.firmar('adriana', ['administrador']),
    };
  });
  after(async () => { await e?.apagar(); });

  const cumple = (nombre, dato) => {
    const validar = ajv.compile({ $ref: `oa#/components/schemas/${nombre}` });
    return validar(dato) ? null : ajv.errorsText(validar.errors);
  };

  // Verifica estado documentado, content-type de errores y esquema del cuerpo
  function verificar(metodo, ruta, r, esquema = null, lista = false) {
    const documentados = Object.keys(spec.paths[ruta][metodo.toLowerCase()].responses);
    assert.ok(documentados.includes(String(r.status)), `${metodo} ${ruta}: devolvió ${r.status}, el contrato documenta [${documentados}]`);
    if (r.status >= 400) {
      assert.match(r.headers.get('content-type'), /application\/problem\+json/, `${metodo} ${ruta} ${r.status}`);
      assert.equal(cumple('ProblemDetails', r.cuerpo), null, `${metodo} ${ruta} ${r.status}: ProblemDetails`);
      return;
    }
    if (!esquema) return;
    for (const dato of lista ? r.cuerpo : [r.cuerpo]) {
      assert.equal(cumple(esquema, dato), null, `${metodo} ${ruta} ${r.status}: ${esquema}`);
    }
  }

  test('lecturas de expensas (propietario y administrador) y sus errores', async () => {
    const lista = await e.llamar('GET', '/v1/expensas?periodo=2026-10', { token: tokens.paula });
    verificar('GET', '/v1/expensas', lista, 'ExpensaResumen', true);
    verificar('GET', '/v1/expensas', await e.llamar('GET', '/v1/expensas', { token: tokens.adriana }), 'ExpensaResumen', true);
    verificar('GET', '/v1/expensas/{id}', await e.llamar('GET', `/v1/expensas/${lista.cuerpo[0].id}`, { token: tokens.paula }), 'ExpensaDetalle');
    verificar('GET', '/v1/expensas', await e.llamar('GET', '/v1/expensas'));
    verificar('GET', '/v1/expensas', await e.llamar('GET', '/v1/expensas?periodo=x', { token: tokens.paula }));
    verificar('GET', '/v1/expensas/{id}', await e.llamar('GET', '/v1/expensas/99999', { token: tokens.paula }));
    const ajena = (await e.llamar('GET', '/v1/expensas', { token: tokens.pablo })).cuerpo[0].id;
    verificar('GET', '/v1/expensas/{id}', await e.llamar('GET', `/v1/expensas/${ajena}`, { token: tokens.paula }));
  });

  test('código de pago: 201, 200 (idempotente), consulta, y 404 si no fue generado', async () => {
    const lista = (await e.llamar('GET', '/v1/expensas', { token: tokens.paula })).cuerpo;
    verificar('PUT', '/v1/expensas/{id}/codigo-pago', await e.llamar('PUT', `/v1/expensas/${lista[0].id}/codigo-pago`, { token: tokens.paula }), 'CodigoPago');
    verificar('PUT', '/v1/expensas/{id}/codigo-pago', await e.llamar('PUT', `/v1/expensas/${lista[0].id}/codigo-pago`, { token: tokens.paula }), 'CodigoPago');
    verificar('GET', '/v1/expensas/{id}/codigo-pago', await e.llamar('GET', `/v1/expensas/${lista[0].id}/codigo-pago`, { token: tokens.paula }), 'CodigoPago');
    verificar('GET', '/v1/expensas/{id}/codigo-pago', await e.llamar('GET', `/v1/expensas/${lista[1].id}/codigo-pago`, { token: tokens.paula }));
  });

  test('conciliación: corrida, detalle con cobranzas, observadas y todos los errores documentados', async () => {
    const lista = (await e.llamar('GET', '/v1/expensas', { token: tokens.paula })).cuerpo;
    const { cuerpo: { codigoPago } } = await e.llamar('GET', `/v1/expensas/${lista[0].id}/codigo-pago`, { token: tokens.paula });
    await e.pagarEnBanco(codigoPago, lista[0].total.centavos, '2020-03-15');
    await e.pagarEnBanco(codigoPago, lista[0].total.centavos, '2020-03-15');     // duplicado -> observada
    const corrida = await e.llamar('POST', '/v1/conciliaciones', { token: tokens.adriana, cuerpo: { fecha: '2020-03-15' } });
    verificar('POST', '/v1/conciliaciones', corrida, 'Conciliacion');
    verificar('GET', '/v1/conciliaciones', await e.llamar('GET', '/v1/conciliaciones', { token: tokens.adriana }), 'Conciliacion', true);
    const detalle = await e.llamar('GET', `/v1/conciliaciones/${corrida.cuerpo.id}`, { token: tokens.adriana });
    verificar('GET', '/v1/conciliaciones/{id}', detalle, 'Conciliacion');
    for (const c of detalle.cuerpo.cobranzas) assert.equal(cumple('Cobranza', c), null);
    verificar('GET', '/v1/cobranzas', await e.llamar('GET', '/v1/cobranzas?estado=OBSERVADA', { token: tokens.adriana }), 'Cobranza', true);
    verificar('GET', '/v1/conciliaciones/{id}', await e.llamar('GET', '/v1/conciliaciones/9999', { token: tokens.adriana }));
    verificar('GET', '/v1/cobranzas', await e.llamar('GET', '/v1/cobranzas', { token: tokens.paula }));
    verificar('POST', '/v1/conciliaciones', await e.llamar('POST', '/v1/conciliaciones', { token: tokens.adriana, cuerpo: { fecha: '2999-01-01' } }));
    verificar('POST', '/v1/conciliaciones', await e.llamar('POST', '/v1/conciliaciones', { token: tokens.adriana, cuerpo: { fecha: 'ayer' } }));
    await e.bancoFalla(true);
    verificar('POST', '/v1/conciliaciones', await e.llamar('POST', '/v1/conciliaciones', { token: tokens.adriana, cuerpo: { fecha: '2020-03-20' } }));
    await e.bancoFalla(false);
    // la expensa pagada: detalle con el pago imputado, y 409 al pedir otro código
    verificar('GET', '/v1/expensas/{id}', await e.llamar('GET', `/v1/expensas/${lista[0].id}`, { token: tokens.paula }), 'ExpensaDetalle');
    verificar('PUT', '/v1/expensas/{id}/codigo-pago', await e.llamar('PUT', `/v1/expensas/${lista[0].id}/codigo-pago`, { token: tokens.paula }));
    verificar('GET', '/health', await e.llamar('GET', '/health'));
  });
});
