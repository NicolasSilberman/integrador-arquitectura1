// Cliente del servicio SOAP del banco (ADR-003). Se autentica con una API key (ADR-010).
import { BancoNoDisponible, isoAFechaBanco, traducirListado } from './traductor.js';

const BANCO_URL = process.env.BANCO_URL ?? 'http://localhost:8090/soap';
const BANCO_API_KEY = process.env.BANCO_API_KEY ?? '';
const TIMEOUT_MS = Number(process.env.BANCO_TIMEOUT_MS ?? 10000);
const NS = 'http://banco.example/cobranzas';

// Pide el listado de cobranzas de una fecha (AAAA-MM-DD) y lo devuelve traducido al modelo propio.
export async function consultarCobranzasDelDia(fechaIso) {
  const pedido = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${NS}">
  <soap:Body>
    <b:ConsultarCobranzasDelDia>
      <FechaProceso>${isoAFechaBanco(fechaIso)}</FechaProceso>
    </b:ConsultarCobranzasDelDia>
  </soap:Body>
</soap:Envelope>`;

  let respuesta;
  try {
    respuesta = await fetch(BANCO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${NS}/ConsultarCobranzasDelDia"`,
        'X-Api-Key': BANCO_API_KEY,
      },
      body: pedido,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new BancoNoDisponible(`No se pudo conectar con el banco (${err.name === 'TimeoutError' ? 'tiempo de espera agotado' : err.message}).`);
  }

  const xml = await respuesta.text();
  if (respuesta.status === 401) throw new BancoNoDisponible('El banco rechazó la API key (401).');
  if (!respuesta.ok) {
    // Un SOAP Fault trae el motivo; si no, alcanza con el código HTTP
    try { traducirListado(xml); } catch (err) { if (err instanceof BancoNoDisponible) throw err; }
    throw new BancoNoDisponible(`El banco respondió HTTP ${respuesta.status}.`);
  }
  return traducirListado(xml);
}
