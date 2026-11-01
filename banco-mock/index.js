// Banco SIMULADO: hace de servicio SOAP heredado del banco (el sistema externo que pide la consigna, ADR-003).
// No es parte del sistema de expensas: en producción se reemplaza por el banco real.
//
// - POST /soap        Operación ConsultarCobranzasDelDia: devuelve las cobranzas de una fecha, en el formato
//                     propio del banco (importes "52800,00", fechas DDMMAAAA y un CodigoRetorno).
//                     Exige la API key en el encabezado X-Api-Key (ADR-010).
// - GET  /            Consola de demo: cargar pagos ("pagar" con un código) y simular que el banco se cae.
// - /_mock/pagos      Pagos cargados (GET lista, POST agrega). Solo para la demo.
// - /_mock/falla      Simulación de caída (GET estado, POST {activa}). Solo para la demo.
// - GET  /health      Estado del servicio.
//
// Los pagos viven en memoria: si se reinicia el contenedor, se pierden (es un simulador).
// Sin dependencias: solo el módulo http de Node.

const http = require('node:http');

const PORT = Number(process.env.PORT ?? 8090);
const API_KEY = process.env.BANCO_API_KEY ?? '';
const NS = 'http://banco.example/cobranzas';

const pagos = [];          // { idOperacion, codigoPago, importe: "52800,00", fecha: "AAAA-MM-DD" }
let falla = false;         // true: el banco "está caído"
let siguiente = 1;

// ---------- Formatos del banco ----------
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }); // AAAA-MM-DD
const isoABanco = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;                     // → DDMMAAAA
function aIso(texto) {                                                                                    // DDMMAAAA o AAAA-MM-DD → AAAA-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto ?? '')) return texto;
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(texto ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
// "52800", "52800.5", "52.800,50" o "52800,50" → "52800,50" (formato del banco). Sin pasar por números con decimales.
function aImporteBanco(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[.,](\d{1,2}))?$/.exec(limpio);
  if (!m) return null;
  const enteros = m[1].replace(/\./g, '');
  if (Number(enteros) === 0 && !Number(m[2] ?? 0)) return null;
  return `${enteros},${(m[2] ?? '00').padEnd(2, '0')}`;
}

// ---------- SOAP ----------
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function respuestaSoap(fechaIso) {
  const items = pagos.filter((p) => p.fecha === fechaIso).map((p) => `
        <Cobranza>
          <IdOperacion>${xml(p.idOperacion)}</IdOperacion>
          <CodigoPago>${xml(p.codigoPago)}</CodigoPago>
          <Importe>${p.importe}</Importe>
          <FechaPago>${isoABanco(p.fecha)}</FechaPago>
        </Cobranza>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${NS}">
  <soap:Body>
    <b:ConsultarCobranzasDelDiaResponse>
      <CodigoRetorno>00</CodigoRetorno>
      <FechaProceso>${isoABanco(fechaIso)}</FechaProceso>
      <Cobranzas>${items}
      </Cobranzas>
    </b:ConsultarCobranzasDelDiaResponse>
  </soap:Body>
</soap:Envelope>`;
}

function faultSoap(codigo, mensaje) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>${codigo}</faultcode>
      <faultstring>${xml(mensaje)}</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;
}

// ---------- Utilidades HTTP ----------
function leerCuerpo(req) {
  return new Promise((resolve) => {
    let cuerpo = '';
    req.on('data', (parte) => { cuerpo += parte; });
    req.on('end', () => resolve(cuerpo));
  });
}
function json(res, status, datos) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(datos));
}
function soap(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
  res.end(cuerpo);
}

// ---------- Servidor ----------
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { status: 'ok', servicio: 'banco-mock', falla });
  }

  // Servicio SOAP del banco
  if (req.method === 'POST' && url.pathname === '/soap') {
    if (!API_KEY || req.headers['x-api-key'] !== API_KEY) {
      return soap(res, 401, faultSoap('soap:Client', 'Credenciales inválidas: falta la API key o no es correcta.'));
    }
    if (falla) {
      return soap(res, 503, faultSoap('soap:Server', 'Servicio no disponible (falla simulada desde la consola).'));
    }
    const cuerpo = await leerCuerpo(req);
    if (!cuerpo.includes('ConsultarCobranzasDelDia')) {
      return soap(res, 500, faultSoap('soap:Client', 'Operación no soportada. Solo existe ConsultarCobranzasDelDia.'));
    }
    const fecha = aIso(/<FechaProceso>([^<]*)<\/FechaProceso>/.exec(cuerpo)?.[1]);
    if (!fecha) return soap(res, 500, faultSoap('soap:Client', 'FechaProceso inválida: se espera DDMMAAAA.'));
    return soap(res, 200, respuestaSoap(fecha));
  }

  // ---- Herramientas de la demo ----
  if (url.pathname === '/_mock/pagos' && req.method === 'GET') return json(res, 200, pagos);

  if (url.pathname === '/_mock/pagos' && req.method === 'POST') {
    let datos;
    try { datos = JSON.parse((await leerCuerpo(req)) || '{}'); } catch { return json(res, 400, { error: 'JSON inválido.' }); }
    const codigoPago = String(datos.codigoPago ?? '').trim();
    const importe = aImporteBanco(datos.importe);
    const fecha = datos.fecha ? aIso(String(datos.fecha).trim()) : hoy();
    if (!/^\d{1,20}$/.test(codigoPago)) return json(res, 400, { error: 'El código de pago debe tener solo dígitos.' });
    if (!importe) return json(res, 400, { error: 'Importe inválido. Ejemplos: 52800,00 o 52800.00' });
    if (!fecha) return json(res, 400, { error: 'Fecha inválida: AAAA-MM-DD.' });
    const pago = { idOperacion: `OP-${String(siguiente++).padStart(4, '0')}`, codigoPago, importe, fecha };
    pagos.push(pago);
    return json(res, 201, pago);
  }

  if (url.pathname === '/_mock/falla' && req.method === 'GET') return json(res, 200, { activa: falla });

  if (url.pathname === '/_mock/falla' && req.method === 'POST') {
    let datos;
    try { datos = JSON.parse((await leerCuerpo(req)) || '{}'); } catch { return json(res, 400, { error: 'JSON inválido.' }); }
    falla = Boolean(datos.activa);
    return json(res, 200, { activa: falla });
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(CONSOLA);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('No encontrado. Endpoints: GET /, GET /health, POST /soap, /_mock/pagos, /_mock/falla');
});

// ---------- Consola de demo ----------
const CONSOLA = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banco simulado</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1d2433;background:#f6f7fb}
  h1{margin-bottom:.2rem} .sub{color:#5b6475;margin-top:0}
  section{background:#fff;border:1px solid #dde1ea;border-radius:8px;padding:1rem 1.2rem;margin:1rem 0}
  label{display:block;font-size:.9rem;margin:.5rem 0 .2rem} input{padding:.45rem;width:100%;box-sizing:border-box;border:1px solid #c5cbd8;border-radius:5px}
  .fila{display:grid;grid-template-columns:2fr 1fr 1fr;gap:.8rem}
  button{margin-top:.8rem;padding:.5rem 1rem;border:0;border-radius:5px;background:#1f5fbf;color:#fff;cursor:pointer}
  button.peligro{background:#b42318} table{width:100%;border-collapse:collapse;font-size:.92rem}
  th,td{text-align:left;padding:.4rem;border-bottom:1px solid #e6e9f0} .msg{margin-top:.6rem;font-size:.9rem}
  .ok{color:#067647} .error{color:#b42318} .estado{font-weight:600}
</style></head><body>
<h1>Banco simulado</h1>
<p class="sub">Herramienta de demo: simula los pagos que hacen los propietarios en el banco y las caídas del servicio.</p>
<section>
  <h2>Registrar un pago</h2>
  <div class="fila">
    <div><label for="codigo">Código de pago</label><input id="codigo" placeholder="00000000125"></div>
    <div><label for="importe">Importe</label><input id="importe" placeholder="52800,00"></div>
    <div><label for="fecha">Fecha del pago</label><input id="fecha" type="date"></div>
  </div>
  <button id="pagar">Registrar pago</button>
  <div id="msg" class="msg"></div>
</section>
<section>
  <h2>Estado del servicio SOAP</h2>
  <p>El servicio está <span id="estado" class="estado">…</span></p>
  <button id="alternar" class="peligro">Simular caída</button>
</section>
<section>
  <h2>Pagos registrados</h2>
  <table><thead><tr><th>Operación</th><th>Código</th><th>Importe</th><th>Fecha</th></tr></thead><tbody id="lista"></tbody></table>
</section>
<script>
const $ = (id) => document.getElementById(id);
$('fecha').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
async function cargar() {
  const pagos = await fetch('/_mock/pagos').then((r) => r.json());
  $('lista').innerHTML = pagos.length ? '' : '<tr><td colspan="4">Todavía no hay pagos.</td></tr>';
  for (const p of pagos) {
    const tr = document.createElement('tr');
    for (const v of [p.idOperacion, p.codigoPago, '$ ' + p.importe, p.fecha]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    $('lista').appendChild(tr);
  }
  const f = await fetch('/_mock/falla').then((r) => r.json());
  $('estado').textContent = f.activa ? 'CAÍDO (falla simulada)' : 'funcionando';
  $('estado').className = 'estado ' + (f.activa ? 'error' : 'ok');
  $('alternar').textContent = f.activa ? 'Restablecer el servicio' : 'Simular caída';
  $('alternar').className = f.activa ? '' : 'peligro';
}
$('pagar').onclick = async () => {
  const r = await fetch('/_mock/pagos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigoPago: $('codigo').value, importe: $('importe').value, fecha: $('fecha').value }) });
  const d = await r.json();
  $('msg').textContent = r.ok ? 'Pago registrado: ' + d.idOperacion : d.error;
  $('msg').className = 'msg ' + (r.ok ? 'ok' : 'error');
  cargar();
};
$('alternar').onclick = async () => {
  const f = await fetch('/_mock/falla').then((r) => r.json());
  await fetch('/_mock/falla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activa: !f.activa }) });
  cargar();
};
cargar();
</script></body></html>`;

servidor.listen(PORT, () => {
  console.log(`[banco-mock] escuchando en el puerto ${PORT}`);
  if (!API_KEY) console.warn('[banco-mock] ATENCIÓN: falta BANCO_API_KEY; el servicio SOAP rechaza todos los pedidos.');
});
