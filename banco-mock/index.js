// BANCO SIMULADO (mock) — hace de "servicio SOAP heredado del banco" del escenario 5A.
// Sin dependencias: solo el módulo http de Node. Reproduce a propósito las rarezas de un servicio viejo:
//   - importes con coma decimal ("52000,50"), fechas DDMMAAAA, códigos de retorno dentro de un HTTP 200.
// Además expone una mini consola (GET /) para "pagar en el banco" durante la demo y para simular que el banco falla.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8090);
const ZONA = process.env.ZONA_HORARIA ?? 'America/Argentina/Buenos_Aires';
const NS = 'http://banco.example/cobranzas';

const pagos = [];          // { nroOperacion, codigoPago, centavos, fecha (ISO) }
let siguiente = 1;
let falla = false;

const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const aImporteBanco = (centavos) => `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`;
const aFechaBanco = (iso) => iso.split('-').reverse().join('');
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, estado, objeto) => {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(objeto));
};
const xml = (res, estado, cuerpo) => {
  res.writeHead(estado, { 'Content-Type': 'text/xml; charset=utf-8' }).end(cuerpo);
};

const WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="${NS}" targetNamespace="${NS}" name="BancoCobranzas">
  <types>
    <xsd:schema targetNamespace="${NS}" elementFormDefault="qualified">
      <xsd:element name="ConsultarCobranzasDelDia">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="FechaProceso" type="xsd:string"/>   <!-- DDMMAAAA -->
        </xsd:sequence></xsd:complexType>
      </xsd:element>
      <xsd:element name="ConsultarCobranzasDelDiaResponse">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="CodigoRetorno" type="xsd:string"/>   <!-- "00" = OK -->
          <xsd:element name="Cobranzas"><xsd:complexType><xsd:sequence>
            <xsd:element name="Cobranza" minOccurs="0" maxOccurs="unbounded"><xsd:complexType><xsd:sequence>
              <xsd:element name="NroOperacion" type="xsd:string"/>
              <xsd:element name="CodigoPagoElectronico" type="xsd:string"/>
              <xsd:element name="ImporteTotal" type="xsd:string"/>      <!-- "52000,50" -->
              <xsd:element name="FechaAcreditacion" type="xsd:string"/> <!-- DDMMAAAA -->
            </xsd:sequence></xsd:complexType></xsd:element>
          </xsd:sequence></xsd:complexType></xsd:element>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </types>
  <message name="Entrada"><part name="parameters" element="tns:ConsultarCobranzasDelDia"/></message>
  <message name="Salida"><part name="parameters" element="tns:ConsultarCobranzasDelDiaResponse"/></message>
  <portType name="BancoCobranzasPort">
    <operation name="ConsultarCobranzasDelDia"><input message="tns:Entrada"/><output message="tns:Salida"/></operation>
  </portType>
  <binding name="BancoCobranzasBinding" type="tns:BancoCobranzasPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="ConsultarCobranzasDelDia">
      <soap:operation soapAction="${NS}/ConsultarCobranzasDelDia"/>
      <input><soap:body use="literal"/></input><output><soap:body use="literal"/></output>
    </operation>
  </binding>
  <service name="BancoCobranzas">
    <port name="BancoCobranzasPort" binding="tns:BancoCobranzasBinding"><soap:address location="http://banco-mock:${PORT}/soap"/></port>
  </service>
</definitions>`;

function respuestaSoap(fechaIso) {
  const filas = pagos.filter((p) => p.fecha === fechaIso).map((p) => `
        <ban:Cobranza>
          <ban:NroOperacion>${p.nroOperacion}</ban:NroOperacion>
          <ban:CodigoPagoElectronico>${p.codigoPago}</ban:CodigoPagoElectronico>
          <ban:ImporteTotal>${aImporteBanco(p.centavos)}</ban:ImporteTotal>
          <ban:FechaAcreditacion>${aFechaBanco(p.fecha)}</ban:FechaAcreditacion>
        </ban:Cobranza>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ban:ConsultarCobranzasDelDiaResponse xmlns:ban="${NS}">
      <ban:CodigoRetorno>00</ban:CodigoRetorno>
      <ban:Cobranzas>${filas}
      </ban:Cobranzas>
    </ban:ConsultarCobranzasDelDiaResponse>
  </soapenv:Body>
</soapenv:Envelope>`;
}

const FALLA_SOAP = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body><soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Servicio fuera de línea por mantenimiento</faultstring></soapenv:Fault></soapenv:Body>
</soapenv:Envelope>`;

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Banco simulado</title>
<style>
  :root{--fondo:#f6f7f9;--tarjeta:#fff;--texto:#1c2430;--suave:#5d6b7c;--borde:#d9dee5;--acento:#1f5fbf;--alerta:#b3261e}
  @media (prefers-color-scheme:dark){:root{--fondo:#12161c;--tarjeta:#1a2029;--texto:#e6eaf0;--suave:#9aa7b6;--borde:#2c3643;--acento:#6ea2ff;--alerta:#ff8a80}}
  body{margin:0;background:var(--fondo);color:var(--texto);font:16px/1.5 system-ui,sans-serif}
  main{max-width:720px;margin:0 auto;padding:24px 16px}
  h1{font-size:1.4rem;margin:0 0 4px} p.s{color:var(--suave);margin:0 0 20px}
  section{background:var(--tarjeta);border:1px solid var(--borde);border-radius:10px;padding:16px;margin-bottom:16px}
  h2{font-size:1rem;margin:0 0 12px} label{display:block;font-size:.85rem;color:var(--suave);margin:8px 0 2px}
  input{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--borde);border-radius:6px;background:var(--fondo);color:var(--texto);font:inherit}
  button{margin-top:12px;padding:8px 14px;border:0;border-radius:6px;background:var(--acento);color:#fff;font:inherit;cursor:pointer}
  button.sec{background:transparent;color:var(--acento);border:1px solid var(--acento)}
  table{width:100%;border-collapse:collapse;font-size:.9rem} td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--borde)}
  .msg{margin-top:10px;color:var(--suave);font-size:.9rem} .caido{color:var(--alerta);font-weight:600}
</style></head><body><main>
<h1>Banco simulado</h1><p class="s">Hace de servicio SOAP heredado del banco. Solo para pruebas y demo.</p>
<section><h2>Pagar una expensa en el banco</h2>
  <label for="codigo">Código de pago (el que entrega el sistema)</label><input id="codigo" inputmode="numeric" autocomplete="off">
  <label for="importe">Importe en pesos (ej. 52000,50)</label><input id="importe" autocomplete="off">
  <label for="fecha">Fecha de acreditación (AAAA-MM-DD)</label><input id="fecha">
  <button id="pagar">Registrar pago</button>
  <div class="msg" id="msgPago">El sistema concilia por día: el pago se verá cuando se concilie la fecha elegida.</div></section>
<section><h2>Estado del servicio</h2>
  <div class="msg" id="estado"></div>
  <button class="sec" id="alternar">Simular caída / restablecer</button></section>
<section><h2>Pagos registrados</h2><table><thead><tr><th>Operación</th><th>Código</th><th>Importe</th><th>Fecha</th></tr></thead><tbody id="lista"></tbody></table></section>
<script>
const $=(i)=>document.getElementById(i);
$('fecha').value=new Date().toLocaleDateString('en-CA',{timeZone:'${ZONA}'});
async function cargar(){
  const [p,f]=await Promise.all([fetch('/_mock/pagos').then(r=>r.json()),fetch('/_mock/falla').then(r=>r.json())]);
  $('lista').innerHTML=p.map(x=>'<tr><td>'+x.nroOperacion+'</td><td>'+x.codigoPago+'</td><td>$ '+x.importe+'</td><td>'+x.fecha+'</td></tr>').join('')||'<tr><td colspan="4">Sin pagos todavía</td></tr>';
  $('estado').innerHTML=f.activa?'<span class="caido">Fuera de línea (simulado)</span>':'En línea';
}
$('pagar').onclick=async()=>{
  const r=await fetch('/_mock/pagos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codigoPago:$('codigo').value.trim(),importe:$('importe').value.trim(),fecha:$('fecha').value.trim()})});
  const d=await r.json(); $('msgPago').textContent=r.ok?'Pago registrado: operación '+d.nroOperacion+'.':(d.error||'Error'); cargar();
};
$('alternar').onclick=async()=>{const f=await fetch('/_mock/falla').then(r=>r.json());await fetch('/_mock/falla',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({activa:!f.activa})});cargar();};
cargar();
</script></main></body></html>`;

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const ruta = url.pathname;

    if (req.method === 'GET' && ruta === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA);
    if (req.method === 'GET' && ruta === '/health') return json(res, 200, { status: 'ok' });

    // ---- El servicio SOAP "real" del banco ----
    if (ruta === '/soap' && req.method === 'GET') return xml(res, 200, WSDL);          // también /soap?wsdl
    if (ruta === '/soap' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      if (falla) return xml(res, 500, FALLA_SOAP);
      const m = /<(?:\w+:)?FechaProceso>\s*(\d{2})(\d{2})(\d{4})\s*<\/(?:\w+:)?FechaProceso>/.exec(cuerpo);
      if (!m) return xml(res, 400, FALLA_SOAP.replace('Servicio fuera de línea por mantenimiento', 'FechaProceso ausente o con formato inválido (se espera DDMMAAAA)'));
      return xml(res, 200, respuestaSoap(`${m[3]}-${m[2]}-${m[1]}`));
    }

    // ---- Ayudas de prueba (no existen en el banco real) ----
    if (ruta === '/_mock/pagos' && req.method === 'GET') {
      return json(res, 200, pagos.map((p) => ({ nroOperacion: p.nroOperacion, codigoPago: p.codigoPago, importe: aImporteBanco(p.centavos), fecha: p.fecha })));
    }
    if (ruta === '/_mock/pagos' && req.method === 'POST') {
      const d = JSON.parse((await leerCuerpo(req)) || '{}');
      const fecha = d.fecha ?? hoyIso();
      const importe = String(d.importe ?? '');
      if (!/^\d+$/.test(d.codigoPago ?? '') || !/^\d+(,\d{1,2})?$/.test(importe) || !esFecha(fecha)) {
        return json(res, 400, { error: 'Datos inválidos: código numérico, importe como "52000,50" y fecha AAAA-MM-DD.' });
      }
      const [ent, dec = ''] = importe.split(',');
      const pago = { nroOperacion: String(siguiente++).padStart(8, '0'), codigoPago: d.codigoPago, centavos: Number(ent) * 100 + Number(dec.padEnd(2, '0')), fecha };
      pagos.push(pago);
      return json(res, 201, { nroOperacion: pago.nroOperacion });
    }
    if (ruta === '/_mock/falla' && req.method === 'GET') return json(res, 200, { activa: falla });
    if (ruta === '/_mock/falla' && req.method === 'POST') {
      falla = Boolean(JSON.parse((await leerCuerpo(req)) || '{}').activa);
      return json(res, 200, { activa: falla });
    }
    json(res, 404, { error: 'No existe' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: 'Error interno del mock' });
  }
});

servidor.listen(PORT, () => console.log(`Banco simulado escuchando en el puerto ${PORT}`));
