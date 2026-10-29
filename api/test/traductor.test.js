// Pruebas unitarias de la capa anticorrupción (no necesitan base ni red).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BancoNoDisponible, BancoRespuestaInvalida, fechaAlBanco, fechaDelBanco, importeACentavos, traducirRespuesta } from '../src/integraciones/banco/traductor.js';
import { codigoDePago } from '../src/modulos/liquidaciones/dominio.js';

describe('ACL del banco', () => {
  test('importes con coma decimal pasan a centavos enteros, sin errores de punto flotante', () => {
    assert.equal(importeACentavos('52000,50'), 5200050);
    assert.equal(importeACentavos('52000,5'), 5200050);
    assert.equal(importeACentavos('0,10'), 10);
    assert.equal(importeACentavos('1234'), 123400);
    assert.equal(importeACentavos('19,99'), 1999);        // parseFloat('19.99')*100 daría 1998.9999999999998
  });

  test('importes con formato desconocido se rechazan', () => {
    for (const malo of ['52.000,50', '-5', '12,345', '', 'abc', undefined]) {
      assert.throws(() => importeACentavos(malo), BancoRespuestaInvalida, String(malo));
    }
  });

  test('fechas DDMMAAAA <-> ISO, y fechas imposibles se rechazan', () => {
    assert.equal(fechaDelBanco('27102026'), '2026-10-27');
    assert.equal(fechaAlBanco('2026-10-27'), '27102026');
    assert.throws(() => fechaDelBanco('31022026'), BancoRespuestaInvalida);
    assert.throws(() => fechaDelBanco('2026-10-27'), BancoRespuestaInvalida);
  });

  test('un CodigoRetorno distinto de "00" es un banco no disponible, aunque el HTTP haya sido 200', () => {
    const sobre = { Envelope: { Body: { ConsultarCobranzasDelDiaResponse: { CodigoRetorno: '91', Cobranzas: '' } } } };
    assert.throws(() => traducirRespuesta(sobre), BancoNoDisponible);
  });

  test('una respuesta sin cobranzas es una lista vacía, no un error', () => {
    const sobre = { Envelope: { Body: { ConsultarCobranzasDelDiaResponse: { CodigoRetorno: '00', Cobranzas: '' } } } };
    assert.deepEqual(traducirRespuesta(sobre), []);
  });
});

describe('Código de pago', () => {
  test('es determinista (misma expensa, mismo código), de 11 dígitos y distinto entre expensas', () => {
    assert.equal(codigoDePago(7), codigoDePago(7));
    assert.match(codigoDePago(7), /^\d{11}$/);
    assert.notEqual(codigoDePago(7), codigoDePago(8));
  });

  test('el dígito verificador detecta un error de tipeo en un dígito', () => {
    const ok = codigoDePago(123);
    const mal = ok.slice(0, 4) + ((Number(ok[4]) + 1) % 10) + ok.slice(5);
    assert.notEqual(ok, mal);
    const base = (c) => c.slice(0, 10);
    // Recalcular el verificador sobre la base alterada no coincide con el dígito original
    assert.notEqual(codigoDePago(Number(base(mal))), mal);
  });
});
