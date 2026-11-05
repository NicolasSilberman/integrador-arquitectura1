// Endpoints de la API (ver openapi.yaml). Las rutas COMPONEN los módulos: cada módulo es dueño de sus datos y
// las rutas los combinan (por ejemplo, Liquidación da las expensas y Padrón dice de quién es cada unidad).
import { Router } from 'express';
import { Problema } from './problemas.js';
import * as padron from '../modulos/padron/index.js';
import * as liquidacion from '../modulos/liquidacion/index.js';
import * as cobranzas from '../modulos/cobranzas/index.js';

export const rutas = Router();

const PERIODO = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function idValido(texto) {
  const id = Number(texto);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new Problema(400, 'Id inválido', 'El id debe ser un número entero positivo.');
  return id;
}

const resumen = (expensa, unidad) => ({
  id: expensa.id,
  consorcio: unidad?.consorcio ?? null,
  unidad: unidad?.codigo ?? null,
  periodo: expensa.periodo,
  vencimiento: expensa.vencimiento,
  total: expensa.total,
  estado: expensa.estado,
});

// Busca la expensa y aplica la REGLA FINA: el administrador accede a todas; el propietario, solo a las de sus unidades.
async function expensaAccesible(req) {
  const id = idValido(req.params.id);
  const expensa = await liquidacion.obtener(id);
  if (!expensa) throw new Problema(404, 'Expensa no encontrada', `No existe una expensa con id ${id}.`);
  const unidad = await padron.unidad(expensa.unidadId);
  const { usuario, esAdministrador } = req.identidad;
  if (!esAdministrador && unidad?.propietario !== usuario) {
    throw new Problema(403, 'Sin permiso', `La expensa ${id} no pertenece a una unidad de ${usuario}.`);
  }
  return { expensa, unidad };
}

// ---------- Expensas ----------
rutas.get('/expensas', async (req, res) => {
  const { periodo, estado } = req.query;
  if (periodo !== undefined && !PERIODO.test(periodo)) throw new Problema(400, 'Parámetro inválido', 'El período debe tener el formato AAAA-MM.');
  if (estado !== undefined && !['EMITIDA', 'PAGADA'].includes(estado)) throw new Problema(400, 'Parámetro inválido', 'El estado debe ser EMITIDA o PAGADA.');

  const { usuario, esAdministrador } = req.identidad;
  const unidadIds = esAdministrador ? null : await padron.unidadesDe(usuario);
  const expensas = await liquidacion.listar({ unidadIds, periodo, estado });
  const unidades = await padron.unidadesPorIds([...new Set(expensas.map((e) => e.unidadId))]);
  res.json(expensas.map((e) => resumen(e, unidades.get(e.unidadId))));
});

rutas.get('/expensas/:id', async (req, res) => {
  const { expensa, unidad } = await expensaAccesible(req);
  const pago = await cobranzas.pagoImputado(expensa.id);
  res.json({
    ...resumen(expensa, unidad),
    conceptos: await liquidacion.conceptos(expensa.id),
    ...(pago ? { pagoImputado: pago } : {}),   // solo si está pagada (en el contrato es opcional)
  });
});

// PUT idempotente (ADR-007): 201 la primera vez, 200 (el mismo código) las siguientes, 409 si ya está pagada
rutas.put('/expensas/:id/codigo-pago', async (req, res) => {
  const { expensa } = await expensaAccesible(req);
  const { codigo, creado } = await liquidacion.asegurarCodigoDePago(expensa.id);
  const cuerpo = { expensaId: expensa.id, codigoPago: codigo, importe: expensa.total, vencimiento: expensa.vencimiento };
  if (!creado) return res.status(200).json(cuerpo);
  res.status(201).location(`/v1/expensas/${expensa.id}/codigo-pago`).json(cuerpo);
});

// ---------- Conciliación (los permisos por rol los aplica el gateway) ----------
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoyEnArgentina = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

// Conciliación manual (la automática corre sola cada mañana, ADR-004). 201 con la corrida; 409 si hay otra en curso;
// 502 si el banco falla (la corrida queda registrada con error).
rutas.post('/conciliaciones', async (req, res) => {
  const { fecha } = req.body ?? {};
  if (typeof fecha !== 'string' || !FECHA.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))
      || new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) !== fecha) {
    throw new Problema(400, 'Datos inválidos', 'Se requiere "fecha" con el formato AAAA-MM-DD.');
  }
  if (fecha > hoyEnArgentina()) throw new Problema(400, 'Datos inválidos', 'No se puede conciliar una fecha futura.');
  const corrida = await cobranzas.conciliar({ fecha, origen: 'MANUAL' });
  res.status(201).location(`/v1/conciliaciones/${corrida.id}`).json(cobranzas.aCorrida(corrida));
});

rutas.get('/conciliaciones/:id', async (req, res) => {
  const id = idValido(req.params.id);
  const corrida = await cobranzas.obtenerCorrida(id);
  if (!corrida) throw new Problema(404, 'Conciliación no encontrada', `No existe una conciliación con id ${id}.`);
  res.json(corrida);
});

rutas.get('/cobranzas', async (req, res) => {
  const { estado } = req.query;
  if (estado !== undefined && !['IMPUTADA', 'OBSERVADA'].includes(estado)) throw new Problema(400, 'Parámetro inválido', 'El estado debe ser IMPUTADA u OBSERVADA.');
  res.json(await cobranzas.listarCobranzas({ estado }));
});
