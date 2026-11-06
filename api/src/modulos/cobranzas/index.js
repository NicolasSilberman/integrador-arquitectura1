// Módulo COBRANZAS: corridas de conciliación y cobranzas informadas por el banco.
// Es el único que lee y escribe las tablas conciliaciones y cobranzas.
// La conciliación contra el banco está en conciliacion.js; acá están las consultas.
import { pool } from '../../db.js';

export { conciliar } from './conciliacion.js';
export { iniciarPlanificador } from './planificador.js';

const dinero = (centavos) => ({ centavos, moneda: 'ARS' });

const aCobranza = (r) => ({
  id: r.id,
  referenciaBanco: r.banco_ref,
  codigoPago: r.codigo_pago,
  monto: dinero(r.monto_centavos),
  fechaPago: r.fecha_pago,
  estado: r.estado,
  motivo: r.motivo,
  expensaId: r.expensa_id,
});

const aCorrida = (r) => ({
  id: r.id,
  fechaCobranzas: r.fecha_cobranzas,
  origen: r.origen,
  estado: r.estado,
  leidas: r.leidas,
  imputadas: r.imputadas,
  observadas: r.observadas,
  yaProcesadas: r.ya_procesadas,
  error: r.error,
});

export async function listarCobranzas({ estado } = {}) {
  const { rows } = estado
    ? await pool.query('SELECT * FROM cobranzas WHERE estado = $1 ORDER BY id', [estado])
    : await pool.query('SELECT * FROM cobranzas ORDER BY id');
  return rows.map(aCobranza);
}

// La cobranza imputada a una expensa (a lo sumo una: lo garantiza el índice una_imputacion_por_expensa)
export async function pagoImputado(expensaId) {
  const { rows } = await pool.query(`SELECT * FROM cobranzas WHERE expensa_id = $1 AND estado = 'IMPUTADA'`, [expensaId]);
  return rows[0] ? aCobranza(rows[0]) : null;
}

export async function obtenerCorrida(id) {
  const { rows } = await pool.query('SELECT * FROM conciliaciones WHERE id = $1', [id]);
  return rows[0] ? aCorrida(rows[0]) : null;
}

export { aCorrida };

// ---------- Consultas del planificador de la conciliación automática ----------

// La fecha más vieja que el sistema intentó conciliar (null si nunca concilió nada)
export async function primeraFechaConciliada() {
  const { rows: [r] } = await pool.query('SELECT min(fecha_cobranzas) AS fecha FROM conciliaciones');
  return r.fecha;
}

// Las fechas entre desde y hasta que ya tienen una corrida OK
export async function fechasConciliadasEntre(desde, hasta) {
  const { rows } = await pool.query(
    `SELECT DISTINCT fecha_cobranzas AS fecha FROM conciliaciones
     WHERE estado = 'OK' AND fecha_cobranzas BETWEEN $1 AND $2`, [desde, hasta]);
  return rows.map((r) => r.fecha);
}

// Minutos desde el último intento de conciliar esa fecha (null si nunca se intentó). Usa el reloj de la base.
export async function minutosDesdeUltimoIntento(fecha) {
  const { rows: [r] } = await pool.query(
    `SELECT extract(epoch FROM now() - max(coalesce(finalizada_en, iniciada_en))) / 60 AS minutos
     FROM conciliaciones WHERE fecha_cobranzas = $1`, [fecha]);
  return r.minutos === null ? null : Number(r.minutos);
}

// Al arrancar la API: una corrida que quedó EN_CURSO es de un proceso que se cortó a la mitad.
// Se marca como ERROR para que el planificador la reintente (lo ya imputado no se duplica, ADR-007).
export async function marcarInterrumpidas() {
  const { rowCount } = await pool.query(
    `UPDATE conciliaciones SET estado = 'ERROR', error = 'Interrumpida: el proceso se reinició durante la corrida.', finalizada_en = now()
     WHERE estado = 'EN_CURSO'`);
  return rowCount;
}
