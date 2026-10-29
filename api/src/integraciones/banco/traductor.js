// CAPA ANTICORRUPCIÓN (Clase 4): traduce el modelo del banco al modelo del dominio.
// El vocabulario y las rarezas del servicio heredado (importes con coma, fechas DDMMAAAA, códigos de retorno
// dentro de un 200) mueren acá: del otro lado de esta capa el dominio solo ve centavos, fechas ISO y errores claros.
import { esFechaIso } from '../../fechas.js';

export class BancoNoDisponible extends Error {}
export class BancoRespuestaInvalida extends Error {}

// "52000,50" -> 5200050. Sin pasar por decimales binarios: la plata no se parsea con parseFloat.
export function importeACentavos(texto) {
  if (!/^\d+(,\d{1,2})?$/.test(texto ?? '')) throw new BancoRespuestaInvalida(`Importe con formato desconocido: "${texto}".`);
  const [enteros, decimales = ''] = texto.split(',');
  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

// "27102026" (DDMMAAAA) -> "2026-10-27"
export function fechaDelBanco(texto) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(texto ?? '');
  const iso = m && `${m[3]}-${m[2]}-${m[1]}`;
  if (!iso || !esFechaIso(iso)) throw new BancoRespuestaInvalida(`Fecha con formato desconocido: "${texto}".`);
  return iso;
}

// "2026-10-27" -> "27102026"
export const fechaAlBanco = (iso) => iso.split('-').reverse().join('');

// Modelo del dominio: { idOperacion, codigoPago, montoCentavos, fechaPago }
export function traducirRespuesta(sobre) {
  const cuerpo = sobre?.Envelope?.Body;
  const resp = cuerpo?.ConsultarCobranzasDelDiaResponse;
  if (!resp) throw new BancoRespuestaInvalida('La respuesta del banco no contiene ConsultarCobranzasDelDiaResponse.');
  // El servicio heredado informa sus errores con un código de retorno dentro de un HTTP 200.
  if (resp.CodigoRetorno !== '00') throw new BancoNoDisponible(`El banco respondió CodigoRetorno ${resp.CodigoRetorno}.`);
  const lista = resp.Cobranzas?.Cobranza ?? [];
  return lista.map((c) => {
    const idOperacion = String(c.NroOperacion ?? '').trim();
    const codigoPago = String(c.CodigoPagoElectronico ?? '').trim();
    if (!idOperacion || !codigoPago) throw new BancoRespuestaInvalida('Cobranza sin NroOperacion o sin CodigoPagoElectronico.');
    return {
      idOperacion,
      codigoPago,
      montoCentavos: importeACentavos(c.ImporteTotal),
      fechaPago: fechaDelBanco(c.FechaAcreditacion),
    };
  });
}
