// Acceso a datos del módulo COBRANZAS (tablas conciliaciones y cobranzas).
import { pool } from '../../db.js';

const aCorrida = (r) => ({
  id: r.id,
  fechaCobranzas: r.fecha_cobranzas,
  origen: r.origen,
  solicitadaPor: r.solicitada_por,
  estado: r.estado,
  leidas: r.leidas,
  imputadas: r.imputadas,
  observadas: r.observadas,
  yaProcesadas: r.ya_procesadas,
  error: r.error,
  iniciadaEn: r.iniciada_en,
  finalizadaEn: r.finalizada_en,
});

const aCobranza = (r) => ({
  id: r.id,
  conciliacionId: r.conciliacion_id,
  bancoRef: r.banco_ref,
  codigoPago: r.codigo_pago,
  monto: { centavos: r.monto_centavos, moneda: 'ARS' },
  fechaPago: r.fecha_pago,
  estado: r.estado,
  motivo: r.motivo,
  expensaId: r.expensa_id,
  procesadaEn: r.procesada_en,
});

export async function crearCorrida({ fecha, origen, solicitadaPor }) {
  const { rows } = await pool.query(
    `INSERT INTO conciliaciones (fecha_cobranzas, origen, solicitada_por, estado) VALUES ($1, $2, $3, 'EN_CURSO') RETURNING *`,
    [fecha, origen, solicitadaPor ?? null]);
  return aCorrida(rows[0]);
}

export async function cerrarCorrida(id, { estado, leidas = 0, imputadas = 0, observadas = 0, yaProcesadas = 0, error = null }) {
  const { rows } = await pool.query(
    `UPDATE conciliaciones SET estado = $2, leidas = $3, imputadas = $4, observadas = $5, ya_procesadas = $6, error = $7,
            finalizada_en = now() WHERE id = $1 RETURNING *`,
    [id, estado, leidas, imputadas, observadas, yaProcesadas, error]);
  return aCorrida(rows[0]);
}

// Reclama el id del banco: INSERT ... ON CONFLICT. Si ya existía devuelve null (la cobranza ya se procesó antes).
export async function reclamarCobranza(db, { idOperacion, codigoPago, montoCentavos, fechaPago }, conciliacionId) {
  const { rows } = await db.query(
    `INSERT INTO cobranzas (banco_ref, conciliacion_id, codigo_pago, monto_centavos, fecha_pago, estado)
     VALUES ($1, $2, $3, $4, $5, 'PROCESANDO') ON CONFLICT (banco_ref) DO NOTHING RETURNING id`,
    [idOperacion, conciliacionId, codigoPago, montoCentavos, fechaPago]);
  return rows[0]?.id ?? null;
}

export async function resolverCobranza(db, id, { estado, motivo = null, expensaId = null }) {
  await db.query('UPDATE cobranzas SET estado = $2, motivo = $3, expensa_id = $4, procesada_en = now() WHERE id = $1',
    [id, estado, motivo, expensaId]);
}

export async function listarCorridas(limite = 50) {
  const { rows } = await pool.query('SELECT * FROM conciliaciones ORDER BY id DESC LIMIT $1', [limite]);
  return rows.map(aCorrida);
}

export async function obtenerCorrida(id) {
  const { rows } = await pool.query('SELECT * FROM conciliaciones WHERE id = $1', [id]);
  return rows[0] ? aCorrida(rows[0]) : null;
}

export async function listarCobranzas({ estado, conciliacionId } = {}) {
  const filtros = [];
  const params = [];
  if (estado) { params.push(estado); filtros.push(`estado = $${params.length}`); }
  if (conciliacionId) { params.push(conciliacionId); filtros.push(`conciliacion_id = $${params.length}`); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM cobranzas ${where} ORDER BY id DESC LIMIT 500`, params);
  return rows.map(aCobranza);
}

export async function pagoImputado(expensaId) {
  const { rows } = await pool.query(`SELECT * FROM cobranzas WHERE expensa_id = $1 AND estado = 'IMPUTADA'`, [expensaId]);
  return rows[0] ? aCobranza(rows[0]) : null;
}

// ---- Consultas que usa el planificador automático ----
export async function ultimaFechaConciliada() {
  const { rows } = await pool.query(`SELECT max(fecha_cobranzas) AS fecha FROM conciliaciones WHERE estado = 'OK'`);
  return rows[0].fecha;
}

// Minutos desde el último intento de conciliar ese día (null si nunca se intentó). Se mide con el reloj de la
// base, el mismo que registró el intento, para no mezclar relojes distintos.
export async function minutosDesdeUltimoIntento(fecha) {
  const { rows } = await pool.query(
    'SELECT EXTRACT(EPOCH FROM (now() - max(iniciada_en))) / 60 AS minutos FROM conciliaciones WHERE fecha_cobranzas = $1', [fecha]);
  return rows[0].minutos === null ? null : Number(rows[0].minutos);
}

// Si el proceso se cayó en medio de una corrida, queda EN_CURSO para siempre. Al arrancar se marca como interrumpida.
export async function marcarInterrumpidas() {
  const { rowCount } = await pool.query(
    `UPDATE conciliaciones SET estado = 'ERROR', error = 'Interrumpida: el proceso se reinició durante la corrida.', finalizada_en = now()
     WHERE estado = 'EN_CURSO'`);
  return rowCount;
}
