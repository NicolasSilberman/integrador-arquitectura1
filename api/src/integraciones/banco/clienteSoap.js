// Cliente del servicio SOAP heredado del banco. Todo el transporte (XML, SOAPAction, timeouts) vive acá.
import { XMLParser } from 'fast-xml-parser';
import { config } from '../../config.js';
import { BancoNoDisponible, BancoRespuestaInvalida, fechaAlBanco, traducirRespuesta } from './traductor.js';

export { BancoNoDisponible, BancoRespuestaInvalida };

// parseTagValue:false mantiene todo como texto: "00012" no puede volverse el número 12.
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, isArray: (nombre) => nombre === 'Cobranza' });

const NS = 'http://banco.example/cobranzas';

function sobre(fechaIso) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ban="${NS}">
  <soapenv:Body>
    <ban:ConsultarCobranzasDelDia>
      <ban:FechaProceso>${fechaAlBanco(fechaIso)}</ban:FechaProceso>
    </ban:ConsultarCobranzasDelDia>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Descarga la lista de cobranzas de UN día (fecha ISO) y la devuelve en el modelo del dominio.
export async function cobranzasDelDia(fechaIso) {
  let resp;
  try {
    resp = await fetch(config.banco.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/ConsultarCobranzasDelDia"` },
      body: sobre(fechaIso),
      signal: AbortSignal.timeout(config.banco.timeoutMs),
    });
  } catch (err) {
    throw new BancoNoDisponible(`No se pudo contactar al banco: ${err.cause?.code ?? err.name}.`);
  }
  const texto = await resp.text();
  if (!resp.ok) {
    const falla = /<faultstring>([^<]*)<\/faultstring>/.exec(texto)?.[1];
    throw new BancoNoDisponible(`El banco respondió HTTP ${resp.status}${falla ? ` (${falla})` : ''}.`);
  }
  let objeto;
  try {
    objeto = parser.parse(texto);
  } catch {
    throw new BancoRespuestaInvalida('La respuesta del banco no es XML válido.');
  }
  return traducirRespuesta(objeto);
}
