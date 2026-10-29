// Conciliación: descarga la cobranza del banco e imputa cada pago a su expensa (ADR-003 y ADR-004).
import { pool, tx } from '../../db.js';
import { Problema } from '../../http/problemas.js';
import * as banco from '../../integraciones/banco/clienteSoap.js';
import * as liquidaciones from '../liquidaciones/index.js';
import * as repo from './repositorio.js';

// Clave del "candado" en la base: garantiza que NUNCA corran dos conciliaciones a la vez
// (por ejemplo, la automática de las 7:00 y una manual del administrador).
const CANDADO_CONCILIACION = 5_150_001;

// Procesa UNA cobranza en su propia transacción. Es idempotente: si el banco repite la misma operación
// (mismo banco_ref) no se vuelve a procesar. Devuelve 'IMPUTADA' | 'OBSERVADA' | 'YA_PROCESADA'.
async function procesar(cobranza, conciliacionId) {
  return tx(async (db) => {
    const id = await repo.reclamarCobranza(db, cobranza, conciliacionId);
    if (id === null) return 'YA_PROCESADA';
    const r = await liquidaciones.imputarPago(db, { codigoPago: cobranza.codigoPago, montoCentavos: cobranza.montoCentavos });
    if (r.ok) {
      await repo.resolverCobranza(db, id, { estado: 'IMPUTADA', expensaId: r.expensaId });
      return 'IMPUTADA';
    }
    // No se imputa nada que no cierre exacto: queda OBSERVADA para que el administrador la resuelva.
    await repo.resolverCobranza(db, id, { estado: 'OBSERVADA', motivo: r.motivo, expensaId: r.expensaId ?? null });
    return 'OBSERVADA';
  });
}

export async function conciliar({ fecha, origen, solicitadaPor }) {
  const sesion = await pool.connect();
  try {
    const { rows } = await sesion.query('SELECT pg_try_advisory_lock($1) AS obtenido', [CANDADO_CONCILIACION]);
    if (!rows[0].obtenido) {
      throw new Problema(409, 'conciliacion-en-curso', 'Conciliación en curso', 'Ya hay una conciliación ejecutándose. Esperá a que termine.');
    }
    const corrida = await repo.crearCorrida({ fecha, origen, solicitadaPor });
    const cuenta = { leidas: 0, imputadas: 0, observadas: 0, yaProcesadas: 0 };
    try {
      const cobranzas = await banco.cobranzasDelDia(fecha);
      cuenta.leidas = cobranzas.length;
      for (const c of cobranzas) {
        const resultado = await procesar(c, corrida.id);
        if (resultado === 'IMPUTADA') cuenta.imputadas++;
        else if (resultado === 'OBSERVADA') cuenta.observadas++;
        else cuenta.yaProcesadas++;
      }
      return await repo.cerrarCorrida(corrida.id, { estado: 'OK', ...cuenta });
    } catch (err) {
      // La corrida queda registrada como ERROR (con lo que alcanzó a hacer). Re-ejecutarla es seguro: es idempotente.
      await repo.cerrarCorrida(corrida.id, { estado: 'ERROR', ...cuenta, error: err.message });
      const bancoCaido = err instanceof banco.BancoNoDisponible || err instanceof banco.BancoRespuestaInvalida;
      throw new Problema(bancoCaido ? 502 : 500, bancoCaido ? 'banco-no-disponible' : 'error-de-conciliacion',
        bancoCaido ? 'Banco no disponible' : 'Error de conciliación',
        `${err.message} La corrida quedó registrada; podés reintentar sin riesgo de duplicar imputaciones.`,
        { extra: { conciliacionId: corrida.id } });
    }
  } finally {
    await sesion.query('SELECT pg_advisory_unlock($1)', [CANDADO_CONCILIACION]).catch(() => {});
    sesion.release();
  }
}
