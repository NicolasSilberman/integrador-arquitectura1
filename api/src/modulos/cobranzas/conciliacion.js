// Conciliación de las cobranzas del banco (ADR-003 y ADR-007).
//
// Descarga el listado de una fecha, y por cada cobranza decide si se imputa a una expensa o queda observada.
// Garantías contra el cobro doble:
//   1. Una sola conciliación a la vez (candado en la base): la segunda recibe 409.
//   2. Cada operación del banco se procesa una sola vez (banco_ref único): un reproceso no duplica nada.
//   3. Una transacción por cobranza, con la expensa bloqueada mientras se imputa.
//   4. Solo se imputa con el monto exacto; si no, la cobranza queda observada con su motivo.
//   5. La base admite a lo sumo una cobranza imputada por expensa (índice una_imputacion_por_expensa).
import { pool, enTransaccion } from '../../db.js';
import { Problema } from '../../http/problemas.js';
import * as liquidacion from '../liquidacion/index.js';
import { consultarCobranzasDelDia } from '../../integraciones/banco/clienteSoap.js';
import { BancoNoDisponible } from '../../integraciones/banco/traductor.js';

const CANDADO_CONCILIACION = 5150001;   // número arbitrario que identifica el candado de la conciliación

class YaProcesada extends Error {}

// Procesa UNA cobranza en su propia transacción. Devuelve 'IMPUTADA', 'OBSERVADA' o 'YA_PROCESADA'.
async function procesarCobranza(cobranza, conciliacionId) {
  try {
    return await enTransaccion(async (db) => {
      const resultado = await liquidacion.imputarPago(db, cobranza);
      const { rowCount } = await db.query(
        `INSERT INTO cobranzas (banco_ref, conciliacion_id, codigo_pago, monto_centavos, fecha_pago, estado, motivo, expensa_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (banco_ref) DO NOTHING`,
        [cobranza.idOperacion, conciliacionId, cobranza.codigoPago, cobranza.montoCentavos, cobranza.fechaPago,
          resultado.imputada ? 'IMPUTADA' : 'OBSERVADA', resultado.imputada ? null : resultado.motivo, resultado.expensaId]);
      // Si la operación del banco ya estaba registrada, se deshace todo lo de esta transacción
      // (incluida la expensa marcada como pagada) y se cuenta como "ya procesada".
      if (rowCount === 0) throw new YaProcesada();
      return resultado.imputada ? 'IMPUTADA' : 'OBSERVADA';
    });
  } catch (err) {
    if (err instanceof YaProcesada) return 'YA_PROCESADA';
    // Última barrera: la base rechazó una segunda imputación de la misma expensa → se registra como observada
    if (err.code === '23505' && err.constraint === 'una_imputacion_por_expensa') {
      return enTransaccion(async (db) => {
        const { rowCount } = await db.query(
          `INSERT INTO cobranzas (banco_ref, conciliacion_id, codigo_pago, monto_centavos, fecha_pago, estado, motivo, expensa_id)
           VALUES ($1, $2, $3, $4, $5, 'OBSERVADA', 'PAGO_DUPLICADO', NULL) ON CONFLICT (banco_ref) DO NOTHING`,
          [cobranza.idOperacion, conciliacionId, cobranza.codigoPago, cobranza.montoCentavos, cobranza.fechaPago]);
        return rowCount === 0 ? 'YA_PROCESADA' : 'OBSERVADA';
      });
    }
    throw err;
  }
}

// Concilia las cobranzas de una fecha (AAAA-MM-DD). origen: 'MANUAL' o 'AUTOMATICA'.
// Devuelve la corrida registrada. Si el banco falla, la corrida queda en ERROR y se lanza un 502.
export async function conciliar({ fecha, origen }) {
  // El candado se toma en una conexión propia y se mantiene durante toda la corrida
  const conexionCandado = await pool.connect();
  try {
    const { rows: [{ obtenido }] } = await conexionCandado.query('SELECT pg_try_advisory_lock($1) AS obtenido', [CANDADO_CONCILIACION]);
    if (!obtenido) throw new Problema(409, 'Conciliación en curso', 'Ya hay una conciliación ejecutándose. Esperá a que termine.');

    try {
      const { rows: [corrida] } = await pool.query(
        `INSERT INTO conciliaciones (fecha_cobranzas, origen, estado) VALUES ($1, $2, 'EN_CURSO') RETURNING id`, [fecha, origen]);

      let listado;
      try {
        listado = await consultarCobranzasDelDia(fecha);
      } catch (err) {
        const motivo = err instanceof BancoNoDisponible ? err.message : `Error inesperado al consultar el banco: ${err.message}`;
        await pool.query(`UPDATE conciliaciones SET estado = 'ERROR', error = $2, finalizada_en = now() WHERE id = $1`, [corrida.id, motivo]);
        throw new Problema(502, 'Banco no disponible', `${motivo} La corrida ${corrida.id} quedó registrada con error y se puede reintentar.`);
      }

      const cuenta = { IMPUTADA: 0, OBSERVADA: 0, YA_PROCESADA: 0 };
      try {
        for (const cobranza of listado) cuenta[await procesarCobranza(cobranza, corrida.id)] += 1;
      } catch (err) {
        await pool.query(`UPDATE conciliaciones SET estado = 'ERROR', error = $2, finalizada_en = now() WHERE id = $1`,
          [corrida.id, `Error al procesar las cobranzas: ${err.message}`]);
        throw err;
      }

      const { rows: [final] } = await pool.query(
        `UPDATE conciliaciones SET estado = 'OK', leidas = $2, imputadas = $3, observadas = $4, ya_procesadas = $5, finalizada_en = now()
         WHERE id = $1 RETURNING *`,
        [corrida.id, listado.length, cuenta.IMPUTADA, cuenta.OBSERVADA, cuenta.YA_PROCESADA]);
      return final;
    } finally {
      await conexionCandado.query('SELECT pg_advisory_unlock($1)', [CANDADO_CONCILIACION]);
    }
  } finally {
    conexionCandado.release();
  }
}
