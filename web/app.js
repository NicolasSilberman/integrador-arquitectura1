// Interfaz web de expensas (ADR-011): páginas estáticas que llaman al gateway con el token del usuario.
// No tiene lógica de negocio ni permisos propios: muestra lo que la API devuelve y lo que la API rechaza.
import Keycloak from './vendor/keycloak.js';

const GATEWAY = 'http://localhost:8000';
const keycloak = new Keycloak({ url: 'http://localhost:8180', realm: 'expensas', clientId: 'web-expensas' });

const $ = (id) => document.getElementById(id);
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const dinero = (m) => pesos.format(m.centavos / 100);
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

const MOTIVOS = {
  MONTO_DISTINTO: 'El monto no coincide con el total',
  CODIGO_DESCONOCIDO: 'Código de pago inexistente',
  PAGO_DUPLICADO: 'La expensa ya estaba pagada',
};

// ---------- Llamadas al gateway ----------

class ErrorApi extends Error {
  constructor(status, problema) {
    super(problema?.detail ?? problema?.title ?? `Error ${status}`);
    this.status = status;
    this.titulo = problema?.title ?? `Error ${status}`;
  }
}

async function api(metodo, ruta, cuerpo) {
  try {
    await keycloak.updateToken(30);   // renueva el token si vence en menos de 30 s
  } catch {
    keycloak.login();                  // la sesión venció: volver a iniciar sesión
    throw new ErrorApi(401, { title: 'Sesión vencida', detail: 'Volvé a iniciar sesión.' });
  }
  let resp;
  try {
    resp = await fetch(GATEWAY + ruta, {
      method: metodo,
      headers: { Authorization: `Bearer ${keycloak.token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(0, { title: 'Sin conexión', detail: 'No se pudo comunicar con el servidor.' });
  }
  const datos = resp.headers.get('content-type')?.includes('json') ? await resp.json() : null;
  if (!resp.ok) throw new ErrorApi(resp.status, datos);   // los errores llegan como Problem Details
  return { status: resp.status, datos };
}

// ---------- Utilidades de pantalla ----------

function avisar(err) {
  const aviso = $('aviso');
  aviso.textContent = err ? `${err.titulo ?? 'Error'}: ${err.message}` : '';
  aviso.hidden = !err;
}

function celda(fila, texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';   // textContent: los datos nunca se interpretan como HTML
  if (clase) td.className = clase;
  fila.appendChild(td);
  return td;
}

const TONO = { PAGADA: 'ok', IMPUTADA: 'ok', EMITIDA: 'pendiente', OBSERVADA: 'error' };

function estadoEtiqueta(estado) {
  const span = document.createElement('span');
  span.className = `estado ${TONO[estado] ?? ''}`;
  const punto = document.createElement('span');
  punto.className = 'punto';
  span.append(punto, estado === 'PAGADA' ? 'Pagada' : estado === 'EMITIDA' ? 'Emitida' : estado.charAt(0) + estado.slice(1).toLowerCase());
  return span;
}

function mostrarVista(nombre) {
  for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== `vista-${nombre}`;
  for (const b of document.querySelectorAll('.pestanias button')) b.classList.toggle('activa', b.dataset.vista === nombre);
  for (const f of document.querySelectorAll('[data-filtro]')) f.hidden = f.dataset.filtro !== nombre;
  avisar(null);
}

// ---------- Expensas ----------

async function cargarExpensas() {
  const estado = $('filtro-estado').value;
  const tbody = $('tabla-expensas');
  tbody.replaceChildren();
  try {
    const { datos } = await api('GET', `/v1/expensas${estado ? `?estado=${estado}` : ''}`);
    for (const e of datos) {
      const fila = document.createElement('tr');
      fila.className = 'clic';
      celda(fila, e.consorcio);
      celda(fila, e.unidad);
      celda(fila, e.periodo, 'mono');
      celda(fila, e.vencimiento, 'mono');
      celda(fila, dinero(e.total), 'num mono');
      celda(fila, '').appendChild(estadoEtiqueta(e.estado));
      fila.addEventListener('click', () => verDetalle(e.id));
      tbody.appendChild(fila);
    }
    $('sin-expensas').hidden = datos.length > 0;
  } catch (err) { avisar(err); }
}

let expensaActual = null;

async function verDetalle(id) {
  try {
    const { datos: e } = await api('GET', `/v1/expensas/${id}`);
    expensaActual = e;
    mostrarVista('detalle');
    $('detalle-titulo').textContent = `${e.consorcio} · Unidad ${e.unidad}`;
    $('detalle-datos').textContent = `Período ${e.periodo} · Vence el ${e.vencimiento} · `;
    $('detalle-datos').appendChild(estadoEtiqueta(e.estado));

    const tbody = $('tabla-conceptos');
    tbody.replaceChildren();
    for (const c of e.conceptos) {
      const fila = document.createElement('tr');
      celda(fila, c.tipo === 'FONDO_RESERVA' ? 'Fondo de reserva' : c.tipo === 'ORDINARIA' ? 'Ordinaria' : c.tipo);
      celda(fila, c.descripcion);
      celda(fila, dinero(c.monto), 'num mono');
      tbody.appendChild(fila);
    }
    $('detalle-total').textContent = dinero(e.total);

    const pagada = e.estado === 'PAGADA';
    $('detalle-pagada').hidden = !pagada;
    $('detalle-pago').hidden = pagada;
    $('codigo').hidden = true;
    if (pagada && e.pagoImputado) {
      const p = e.pagoImputado;
      $('detalle-pagada').textContent = `Pagada el ${p.fechaPago} por ${dinero(p.monto)} (operación del banco ${p.referenciaBanco}).`;
    }
  } catch (err) { avisar(err); }
}

async function pedirCodigo() {
  try {
    const { datos } = await api('PUT', `/v1/expensas/${expensaActual.id}/codigo-pago`);
    $('codigo-valor').textContent = datos.codigoPago;
    $('codigo-importe').textContent = dinero(datos.importe);
    $('codigo-vencimiento').textContent = datos.vencimiento;
    $('codigo').hidden = false;
  } catch (err) { avisar(err); }
}

// ---------- Conciliación (administrador) ----------

async function conciliar(evento) {
  evento.preventDefault();
  const fecha = $('fecha-conciliar').value;
  const caja = $('resultado-corrida');
  caja.hidden = true;
  try {
    const { datos: c } = await api('POST', '/v1/conciliaciones', { fecha });
    caja.className = 'tarjeta ok';
    caja.replaceChildren();
    const titulo = document.createElement('strong');
    titulo.textContent = `Corrida ${c.id} del ${c.fechaCobranzas}: ${c.estado}`;
    const metricas = document.createElement('div');
    metricas.className = 'metricas';
    for (const [nombre, valor] of [['Leídas', c.leidas], ['Imputadas', c.imputadas], ['Observadas', c.observadas], ['Ya procesadas', c.yaProcesadas]]) {
      const bloque = document.createElement('div');
      bloque.className = 'metrica';
      const v = document.createElement('span');
      v.className = 'valor';
      v.textContent = valor;
      const n = document.createElement('span');
      n.className = 'nombre';
      n.textContent = nombre;
      bloque.append(v, n);
      metricas.appendChild(bloque);
    }
    caja.append(titulo, metricas);
    caja.hidden = false;
  } catch (err) {
    caja.className = 'tarjeta error';
    caja.textContent = `${err.titulo}: ${err.message}`;   // 409 si hay otra en curso, 502 si el banco no responde
    caja.hidden = false;
  }
}

// ---------- Cobranzas (administrador) ----------

async function cargarCobranzas() {
  const estado = $('filtro-cobranzas').value;
  const tbody = $('tabla-cobranzas');
  tbody.replaceChildren();
  try {
    const { datos } = await api('GET', `/v1/cobranzas${estado ? `?estado=${estado}` : ''}`);
    for (const c of datos) {
      const fila = document.createElement('tr');
      celda(fila, c.referenciaBanco, 'mono');
      celda(fila, c.codigoPago, 'mono');
      celda(fila, dinero(c.monto), 'num mono');
      celda(fila, c.fechaPago, 'mono');
      celda(fila, '').appendChild(estadoEtiqueta(c.estado));
      celda(fila, c.motivo ? (MOTIVOS[c.motivo] ?? c.motivo) : null);
      celda(fila, c.expensaId);
      tbody.appendChild(fila);
    }
    $('sin-cobranzas').hidden = datos.length > 0;
  } catch (err) { avisar(err); }
}

// ---------- Inicio ----------

function iniciarAplicacion() {
  const { preferred_username: usuario, realm_access } = keycloak.tokenParsed;
  const esAdministrador = realm_access?.roles?.includes('administrador');
  $('usuario').textContent = `${usuario} · ${esAdministrador ? 'administrador' : 'propietario'}`;
  $('usuario').hidden = false;
  $('salir').hidden = false;
  $('aplicacion').hidden = false;
  // Las pestañas del administrador solo se muestran a ese rol. Igual, quien decide los permisos es el gateway.
  for (const b of document.querySelectorAll('[data-rol="administrador"]')) b.hidden = !esAdministrador;
  // Con una sola pestaña (propietario), la barra se muestra como título de sección
  document.querySelector('.pestanias').classList.toggle('unica', !esAdministrador);

  for (const b of document.querySelectorAll('.pestanias button')) {
    b.addEventListener('click', () => {
      mostrarVista(b.dataset.vista);
      if (b.dataset.vista === 'expensas') cargarExpensas();
      if (b.dataset.vista === 'cobranzas') cargarCobranzas();
    });
  }
  $('filtro-estado').addEventListener('change', cargarExpensas);
  $('filtro-cobranzas').addEventListener('change', cargarCobranzas);
  $('volver').addEventListener('click', () => { mostrarVista('expensas'); cargarExpensas(); });
  $('pedir-codigo').addEventListener('click', pedirCodigo);
  $('fecha-conciliar').value = hoy();
  $('fecha-conciliar').max = hoy();
  $('form-conciliar').addEventListener('submit', conciliar);
  $('salir').addEventListener('click', () => keycloak.logout({ redirectUri: window.location.origin + '/' }));

  mostrarVista('expensas');
  cargarExpensas();
}

try {
  // Authorization Code + PKCE (cliente público). Sin el iframe de sesión: el token se renueva al usarlo.
  const autenticado = await keycloak.init({ pkceMethod: 'S256', checkLoginIframe: false });
  if (autenticado) iniciarAplicacion();
  else {
    $('bienvenida').hidden = false;
    $('ingresar').addEventListener('click', () => keycloak.login());
  }
} catch {
  $('bienvenida').hidden = false;
  avisar({ titulo: 'Identidad no disponible', message: 'No se pudo contactar al proveedor de identidad. Probá de nuevo en un minuto.' });
}
