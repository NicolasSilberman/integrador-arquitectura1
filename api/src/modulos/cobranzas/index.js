// Módulo COBRANZAS: corridas de conciliación y cobranzas informadas por el banco.
// Es el único que lee y escribe las tablas conciliaciones y cobranzas.
// La conciliación contra el banco está en conciliacion.js; acá están las consultas.
import { pool } from '../../db.js';

export { conciliar } from './conciliacion.js';

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
