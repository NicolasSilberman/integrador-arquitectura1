// CAPA ANTICORRUPCIÓN (ADR-003): traduce el formato del servicio SOAP heredado del banco al modelo propio.
// El dominio nunca ve el formato del banco: importes "52800,50", fechas DDMMAAAA ni códigos de retorno.

// El banco no respondió o respondió con error: la conciliación se registra con error y se reintenta.
export class BancoNoDisponible extends Error {
  constructor(motivo) { super(motivo); this.name = 'BancoNoDisponible'; }
}

// "52800,50" → 5280050 centavos. Sin pasar por números con decimales: se separa la parte entera de la decimal.
export function importeACentavos(texto) {
  const m = /^(\d+),(\d{2})$/.exec(String(texto ?? '').trim());
  if (!m) throw new BancoNoDisponible(`Importe con formato inesperado: "${texto}".`);
  return Number(m[1]) * 100 + Number(m[2]);
}

// DDMMAAAA → AAAA-MM-DD
export function fechaAIso(texto) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(texto ?? '').trim());
  if (!m) throw new BancoNoDisponible(`Fecha con formato inesperado: "${texto}".`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// AAAA-MM-DD → DDMMAAAA (para pedirle una fecha al banco)
export const isoAFechaBanco = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const campo = (xml, nombre) => {
  const m = new RegExp(`<(?:\\w+:)?${nombre}>([^<]*)</(?:\\w+:)?${nombre}>`).exec(xml);
  return m ? desescapar(m[1].trim()) : null;
};

// Respuesta SOAP de ConsultarCobranzasDelDia → [{ idOperacion, codigoPago, montoCentavos, fechaPago }]
export function traducirListado(xml) {
  const fault = campo(xml, 'faultstring');
  if (fault) throw new BancoNoDisponible(`El banco respondió con error: ${fault}`);
  // El banco informa errores de negocio dentro de una respuesta "exitosa": CodigoRetorno distinto de "00"
  const codigoRetorno = campo(xml, 'CodigoRetorno');
  if (codigoRetorno === null) throw new BancoNoDisponible('Respuesta del banco sin CodigoRetorno.');
  if (codigoRetorno !== '00') throw new BancoNoDisponible(`El banco respondió con el código de retorno ${codigoRetorno}.`);

  const bloques = xml.match(/<(?:\w+:)?Cobranza>[\s\S]*?<\/(?:\w+:)?Cobranza>/g) ?? [];
  return bloques.map((b) => {
    const idOperacion = campo(b, 'IdOperacion');
    const codigoPago = campo(b, 'CodigoPago');
    if (!idOperacion || !codigoPago) throw new BancoNoDisponible('Cobranza sin IdOperacion o sin CodigoPago.');
    return {
      idOperacion,
      codigoPago,
      montoCentavos: importeACentavos(campo(b, 'Importe')),
      fechaPago: fechaAIso(campo(b, 'FechaPago')),
    };
  });
}
