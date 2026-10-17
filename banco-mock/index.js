// Banco SIMULADO: hace de servicio SOAP heredado del banco (el sistema externo que pide la consigna).
// No es parte del sistema de expensas: en producción se reemplaza por el banco real (ADR-003).
//
// Por ahora es un "hola mundo": responde la operación ConsultarCobranzasDelDia con un listado de ejemplo,
// en el formato propio del banco (importes "52800,00", fechas DDMMAAAA y un CodigoRetorno).
// Sin dependencias: solo el módulo http de Node.

const http = require('node:http');

const PORT = Number(process.env.PORT ?? 8090);
const NS = 'http://banco.example/cobranzas';

// Listado de ejemplo. Más adelante se va a poder cargar pagos desde una consola para la demo.
const cobranzasDeEjemplo = [
  { idOperacion: 'OP-0001', codigoPago: '00000000125', importe: '52800,00' },
  { idOperacion: 'OP-0002', codigoPago: '00000000133', importe: '48000,00' },
];

// AAAA-MM-DD (o DDMMAAAA) → DDMMAAAA, que es como el banco escribe las fechas
const aFechaBanco = (texto) => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? '');
  return iso ? `${iso[3]}${iso[2]}${iso[1]}` : (texto ?? '');
};

function respuestaSoap(fechaProceso) {
  const items = cobranzasDeEjemplo.map((c) => `
        <Cobranza>
          <IdOperacion>${c.idOperacion}</IdOperacion>
          <CodigoPago>${c.codigoPago}</CodigoPago>
          <Importe>${c.importe}</Importe>
          <FechaPago>${fechaProceso}</FechaPago>
        </Cobranza>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${NS}">
  <soap:Body>
    <b:ConsultarCobranzasDelDiaResponse>
      <CodigoRetorno>00</CodigoRetorno>
      <FechaProceso>${fechaProceso}</FechaProceso>
      <Cobranzas>${items}
      </Cobranzas>
    </b:ConsultarCobranzasDelDiaResponse>
  </soap:Body>
</soap:Envelope>`;
}

function faultSoap(mensaje) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>${mensaje}</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let cuerpo = '';
    req.on('data', (parte) => { cuerpo += parte; });
    req.on('end', () => resolve(cuerpo));
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', servicio: 'banco-mock' }));
  }

  if (req.method === 'POST' && url.pathname === '/soap') {
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.includes('ConsultarCobranzasDelDia')) {
      res.writeHead(500, { 'Content-Type': 'text/xml; charset=utf-8' });
      return res.end(faultSoap('Operación no soportada. Solo existe ConsultarCobranzasDelDia.'));
    }
    const fecha = /<FechaProceso>([^<]*)<\/FechaProceso>/.exec(cuerpo)?.[1];
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    return res.end(respuestaSoap(aFechaBanco(fecha)));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('No encontrado. Endpoints: GET /health, POST /soap');
});

servidor.listen(PORT, () => console.log(`[banco-mock] escuchando en el puerto ${PORT}`));
