// API de expensas — con datos de ejemplo (avances del 22/10 y 29/10).
//
// Implementa los endpoints del contrato (openapi.yaml) con DATOS DE EJEMPLO en memoria. Todavía no hay lógica
// de negocio: las expensas, la conciliación y las cobranzas salen de este archivo, y la base solo se usa en /health.
// La implementación real, organizada en módulos (Padrón, Liquidación, Cobranzas), reemplaza estos datos.
//
// Seguridad (ADR-006): la API no publica su puerto; solo se llega a ella a través del GATEWAY, que valida el token,
// aplica los permisos por rol y reenvía la identidad en los encabezados X-Usuario y X-Roles.
// Acá se resuelve la REGLA FINA: un propietario solo ve y paga SUS expensas.

import express from 'express';
import pg from 'pg';

const app = express();
app.use(express.json());

// La configuración llega por variables de entorno (las define docker-compose.yml)
const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'expensas',
  user: process.env.DB_USER ?? 'expensas',
  password: process.env.DB_PASSWORD,
});

// Errores con Problem Details (RFC 9457)
function problem(res, status, title, detail, instance) {
  res.status(status).type('application/problem+json').json({
    type: 'about:blank', title, status, detail, instance,
  });
}

// ---------------------------------------------------------------------------
// Datos de ejemplo (en memoria). Los importes van en centavos.
// ---------------------------------------------------------------------------
const ars = (centavos) => ({ centavos, moneda: 'ARS' });

const cobranzas = [
  {
    id: 31, referenciaBanco: 'OP-0002', codigoPago: '00000000133', monto: ars(4800000),
    fechaPago: '2026-10-21', estado: 'IMPUTADA', motivo: null, expensaId: 13,
  },
  {
    id: 32, referenciaBanco: 'OP-0003', codigoPago: '00000000999', monto: ars(5000000),
    fechaPago: '2026-10-21', estado: 'OBSERVADA', motivo: 'CODIGO_DESCONOCIDO', expensaId: null,
  },
];

const expensas = [
  {
    id: 12, consorcio: 'Edificio Av. Vergara 1200', unidad: '2B', propietario: 'paula', periodo: '2026-10',
    vencimiento: '2026-11-10', estado: 'EMITIDA',
    conceptos: [
      { tipo: 'ORDINARIA', descripcion: 'Expensas ordinarias', monto: ars(4500000) },
      { tipo: 'FONDO_RESERVA', descripcion: 'Fondo de reserva', monto: ars(780000) },
    ],
  },
  {
    id: 13, consorcio: 'Edificio Av. Vergara 1200', unidad: '3A', propietario: null, periodo: '2026-10',
    vencimiento: '2026-11-10', estado: 'PAGADA',
    conceptos: [
      { tipo: 'ORDINARIA', descripcion: 'Expensas ordinarias', monto: ars(4100000) },
      { tipo: 'FONDO_RESERVA', descripcion: 'Fondo de reserva', monto: ars(700000) },
    ],
  },
  {
    id: 14, consorcio: 'Torre Pedro Díaz 450', unidad: '4C', propietario: 'pablo', periodo: '2026-10',
    vencimiento: '2026-11-10', estado: 'EMITIDA',
    conceptos: [
      { tipo: 'ORDINARIA', descripcion: 'Expensas ordinarias', monto: ars(3900000) },
      { tipo: 'EXTRAORDINARIA', descripcion: 'Arreglo de ascensor (cuota 2 de 6)', monto: ars(1200000) },
      { tipo: 'FONDO_RESERVA', descripcion: 'Fondo de reserva', monto: ars(600000) },
    ],
  },
  {
    id: 15, consorcio: 'Edificio Jauretche 870', unidad: '1A', propietario: 'paula', periodo: '2026-10',
    vencimiento: '2026-11-10', estado: 'EMITIDA',
    conceptos: [
      { tipo: 'ORDINARIA', descripcion: 'Expensas ordinarias', monto: ars(4300000) },
      { tipo: 'FONDO_RESERVA', descripcion: 'Fondo de reserva', monto: ars(500000) },
    ],
  },
];
// propietario = usuario del proveedor de identidad (null: la unidad no tiene cuenta en el sistema).
// Coinciden con el Padrón de db/init.sql: paula es dueña de 2B (consorcio 1) y 1A (consorcio 3); pablo, de 4C (consorcio 2).

// Expensas que ya tienen código de pago generado (la 13 lo tuvo antes de pagarse)
const conCodigo = new Set([13]);
const conciliaciones = [];

// El total nunca se guarda: es la suma de los conceptos
const total = (e) => ars(e.conceptos.reduce((suma, c) => suma + c.monto.centavos, 0));

// Código de pago: el id con 10 dígitos + un dígito verificador (algoritmo de Luhn)
function codigoDePago(id) {
  const base = String(id).padStart(10, '0');
  let suma = 0;
  [...base].reverse().forEach((d, i) => {
    let n = Number(d);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    suma += n;
  });
  return base + ((10 - (suma % 10)) % 10);
}

const resumen = (e) => ({
  id: e.id, consorcio: e.consorcio, unidad: e.unidad, periodo: e.periodo,
  vencimiento: e.vencimiento, total: total(e), estado: e.estado,
});

// pagoImputado solo aparece si la expensa está pagada (en el contrato es opcional)
function detalle(e) {
  const pago = cobranzas.find((c) => c.expensaId === e.id && c.estado === 'IMPUTADA');
  return { ...resumen(e), conceptos: e.conceptos, ...(pago ? { pagoImputado: pago } : {}) };
}

const PERIODO = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Identidad (la pone el gateway) y regla fina
// ---------------------------------------------------------------------------
// Si falta la identidad, el pedido no vino por el gateway: se rechaza (ante la duda, se rechaza).
app.use('/v1', (req, res, next) => {
  const usuario = req.get('X-Usuario');
  const roles = (req.get('X-Roles') ?? '').split(',').filter(Boolean);
  if (!usuario || roles.length === 0) {
    return problem(res, 401, 'No autenticado', 'El pedido no trae la identidad del usuario.', req.originalUrl);
  }
  req.identidad = { usuario, esAdministrador: roles.includes('administrador') };
  next();
});

// Regla fina: el administrador accede a todas; el propietario, solo a las de sus unidades
const puedeVer = (identidad, expensa) => identidad.esAdministrador || expensa.propietario === identidad.usuario;

function buscarExpensa(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    problem(res, 400, 'Id inválido', 'El id debe ser un número entero positivo.', req.originalUrl);
    return null;
  }
  const expensa = expensas.find((e) => e.id === id);
  if (!expensa) {
    problem(res, 404, 'Expensa no encontrada', `No existe una expensa con id ${id}.`, req.originalUrl);
    return null;
  }
  if (!puedeVer(req.identidad, expensa)) {
    problem(res, 403, 'Sin permiso', `La expensa ${id} no pertenece a una unidad de ${req.identidad.usuario}.`, req.originalUrl);
    return null;
  }
  return expensa;
}

// ---------------------------------------------------------------------------
// Endpoints (ver openapi.yaml)
// ---------------------------------------------------------------------------
app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

app.get('/v1/expensas', (req, res) => {
  const { periodo, estado } = req.query;
  if (periodo !== undefined && !PERIODO.test(periodo)) {
    return problem(res, 400, 'Parámetro inválido', 'El período debe tener el formato AAAA-MM.', req.originalUrl);
  }
  if (estado !== undefined && !['EMITIDA', 'PAGADA'].includes(estado)) {
    return problem(res, 400, 'Parámetro inválido', 'El estado debe ser EMITIDA o PAGADA.', req.originalUrl);
  }
  const lista = expensas
    .filter((e) => puedeVer(req.identidad, e))
    .filter((e) => periodo === undefined || e.periodo === periodo)
    .filter((e) => estado === undefined || e.estado === estado);
  res.json(lista.map(resumen));
});

app.get('/v1/expensas/:id', (req, res) => {
  const expensa = buscarExpensa(req, res);
  if (expensa) res.json(detalle(expensa));
});

// PUT idempotente: 201 la primera vez, 200 (el mismo código) las siguientes, 409 si ya está pagada
app.put('/v1/expensas/:id/codigo-pago', (req, res) => {
  const expensa = buscarExpensa(req, res);
  if (!expensa) return;
  if (expensa.estado === 'PAGADA') {
    return problem(res, 409, 'Expensa ya pagada',
      `La expensa ${expensa.id} ya está pagada; no se puede generar un código de pago.`, req.originalUrl);
  }
  const yaTenia = conCodigo.has(expensa.id);
  conCodigo.add(expensa.id);
  const cuerpo = {
    expensaId: expensa.id, codigoPago: codigoDePago(expensa.id), importe: total(expensa), vencimiento: expensa.vencimiento,
  };
  if (yaTenia) return res.status(200).json(cuerpo);
  res.status(201).location(`/v1/expensas/${expensa.id}/codigo-pago`).json(cuerpo);
});

// Por ahora devuelve una corrida de ejemplo; la descarga real del banco (banco-mock) llega con la conciliación
app.post('/v1/conciliaciones', (req, res) => {
  const { fecha } = req.body ?? {};
  if (typeof fecha !== 'string' || !FECHA.test(fecha) || Number.isNaN(Date.parse(fecha))) {
    return problem(res, 400, 'Datos inválidos', 'Se requiere "fecha" con el formato AAAA-MM-DD.', req.originalUrl);
  }
  const corrida = {
    id: conciliaciones.length + 1, fechaCobranzas: fecha, origen: 'MANUAL', estado: 'OK',
    leidas: 2, imputadas: 1, observadas: 1, yaProcesadas: 0, error: null,
  };
  conciliaciones.push(corrida);
  res.status(201).location(`/v1/conciliaciones/${corrida.id}`).json(corrida);
});

app.get('/v1/conciliaciones/:id', (req, res) => {
  const corrida = conciliaciones.find((c) => c.id === Number(req.params.id));
  if (!corrida) {
    return problem(res, 404, 'Conciliación no encontrada', `No existe una conciliación con id ${req.params.id}.`, req.originalUrl);
  }
  res.json(corrida);
});

app.get('/v1/cobranzas', (req, res) => {
  const { estado } = req.query;
  if (estado !== undefined && !['IMPUTADA', 'OBSERVADA'].includes(estado)) {
    return problem(res, 400, 'Parámetro inválido', 'El estado debe ser IMPUTADA u OBSERVADA.', req.originalUrl);
  }
  res.json(cobranzas.filter((c) => estado === undefined || c.estado === estado));
});

// Ruta inexistente → 404 con Problem Details
app.use((req, res) => problem(res, 404, 'No encontrado', `No existe la ruta ${req.method} ${req.path}.`, req.originalUrl));

// Cualquier error inesperado → 500 con Problem Details, sin detalles internos
app.use((err, req, res, next) => {
  console.error(err);
  problem(res, 500, 'Error interno', 'Ocurrió un error inesperado.', req.originalUrl);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API de expensas escuchando en el puerto ${port}`));
