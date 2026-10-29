// Módulo LIQUIDACIONES: la expensa mensual de cada unidad (Aggregate Root: Expensa, con sus conceptos).
// Es dueño de las tablas expensas y expensa_conceptos. Su interfaz pública es este archivo.
import { pool, tx } from '../../db.js';
import { Problema } from '../../http/problemas.js';
import { codigoDePago, dinero } from './dominio.js';

// El total se calcula siempre desde los conceptos: no hay un total guardado que pueda desincronizarse.
const TOTAL = `COALESCE((SELECT SUM(c.monto_centavos) FROM expensa_conceptos c WHERE c.expensa_id = e.id), 0)::bigint`;
const SELECT = `SELECT e.id, e.unidad_id, e.periodo, e.vencimiento, e.estado, e.codigo_pago, ${TOTAL} AS total_centavos FROM expensas e`;

const aExpensa = (r) => ({
  id: r.id,
  unidadId: r.unidad_id,
  periodo: r.periodo,
  vencimiento: r.vencimiento,
  estado: r.estado,
  codigoPago: r.codigo_pago,
  total: dinero(r.total_centavos),
});

const noExiste = (id) => new Problema(404, 'expensa-no-encontrada', 'Expensa no encontrada', `No existe una expensa con id ${id}.`);

export async function listar({ unidadIds = null, periodo, estado } = {}) {
  const filtros = [];
  const params = [];
  if (unidadIds) { params.push(unidadIds); filtros.push(`e.unidad_id = ANY($${params.length}::int[])`); }
  if (periodo) { params.push(periodo); filtros.push(`e.periodo = $${params.length}`); }
  if (estado) { params.push(estado); filtros.push(`e.estado = $${params.length}`); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await pool.query(`${SELECT} ${where} ORDER BY e.periodo DESC, e.id`, params);
  return rows.map(aExpensa);
}

export async function obtener(id) {
  const { rows } = await pool.query(`${SELECT} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw noExiste(id);
  return aExpensa(rows[0]);
}

export async function conceptos(expensaId) {
  const { rows } = await pool.query(
    'SELECT descripcion, monto_centavos FROM expensa_conceptos WHERE expensa_id = $1 ORDER BY id', [expensaId]);
  return rows.map((r) => ({ descripcion: r.descripcion, monto: dinero(r.monto_centavos) }));
}

// PUT /expensas/{id}/codigo-pago: idempotente. Primera vez crea el código; las siguientes devuelven el mismo.
export async function asegurarCodigoDePago(id) {
  return tx(async (db) => {
    const { rows } = await db.query('SELECT id, estado, codigo_pago FROM expensas WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw noExiste(id);
    const e = rows[0];
    if (e.estado === 'PAGADA') {
      throw new Problema(409, 'expensa-ya-pagada', 'Expensa ya pagada', `La expensa ${id} ya está pagada: no se puede generar un código de pago.`);
    }
    if (e.codigo_pago) return { codigoPago: e.codigo_pago, creado: false };
    const codigo = codigoDePago(id);
    await db.query('UPDATE expensas SET codigo_pago = $1 WHERE id = $2', [codigo, id]);
    return { codigoPago: codigo, creado: true };
  });
}

// Lo llama el módulo de cobranzas DENTRO de su transacción cuando el banco informa un pago.
// Decide si el pago se puede imputar a una expensa. Es la regla central del dominio:
// una expensa se paga UNA vez, por su importe exacto.
export async function imputarPago(db, { codigoPago, montoCentavos }) {
  // FOR UPDATE: si dos procesos intentan imputar la misma expensa, el segundo espera y encuentra ya PAGADA.
  const { rows } = await db.query(
    `SELECT e.id, e.estado, ${TOTAL} AS total_centavos FROM expensas e WHERE e.codigo_pago = $1 FOR UPDATE OF e`, [codigoPago]);
  if (!rows[0]) return { ok: false, motivo: 'CODIGO_DESCONOCIDO' };
  const e = rows[0];
  if (e.estado === 'PAGADA') return { ok: false, motivo: 'PAGO_DUPLICADO', expensaId: e.id };
  if (e.total_centavos !== montoCentavos) return { ok: false, motivo: 'MONTO_DISTINTO', expensaId: e.id };
  await db.query(`UPDATE expensas SET estado = 'PAGADA' WHERE id = $1`, [e.id]);
  return { ok: true, expensaId: e.id };
}
