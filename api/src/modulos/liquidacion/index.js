// Módulo LIQUIDACIÓN: expensas, sus conceptos y el código de pago.
// Es el único que lee y escribe las tablas liquidaciones, gastos, expensas y expensa_conceptos.
import { pool, enTransaccion } from '../../db.js';
import { Problema } from '../../http/problemas.js';
import { codigoDePago, dinero } from './dominio.js';

// El total nunca se guarda: es la suma de los conceptos (ADR-002)
const SELECT_EXPENSA = `
  SELECT e.id, e.unidad_id, e.periodo, e.vencimiento, e.estado, e.codigo_pago,
         (SELECT COALESCE(SUM(c.monto_centavos), 0) FROM expensa_conceptos c WHERE c.expensa_id = e.id)::bigint AS total_centavos
  FROM expensas e`;

const aExpensa = (r) => ({
  id: r.id,
  unidadId: r.unidad_id,
  periodo: r.periodo,
  vencimiento: r.vencimiento,
  estado: r.estado,
  codigoPago: r.codigo_pago,
  total: dinero(r.total_centavos),
});

// unidadIds: null = todas (administrador); un array = solo esas unidades (propietario)
export async function listar({ unidadIds = null, periodo, estado } = {}) {
  const filtros = [];
  const params = [];
  if (unidadIds !== null) { params.push(unidadIds); filtros.push(`e.unidad_id = ANY($${params.length}::int[])`); }
  if (periodo) { params.push(periodo); filtros.push(`e.periodo = $${params.length}`); }
  if (estado) { params.push(estado); filtros.push(`e.estado = $${params.length}`); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await pool.query(`${SELECT_EXPENSA} ${where} ORDER BY e.id`, params);
  return rows.map(aExpensa);
}

export async function obtener(id) {
  const { rows } = await pool.query(`${SELECT_EXPENSA} WHERE e.id = $1`, [id]);
  return rows[0] ? aExpensa(rows[0]) : null;
}

export async function conceptos(expensaId) {
  const { rows } = await pool.query(
    'SELECT tipo, descripcion, monto_centavos FROM expensa_conceptos WHERE expensa_id = $1 ORDER BY id', [expensaId]);
  return rows.map((r) => ({ tipo: r.tipo, descripcion: r.descripcion, monto: dinero(r.monto_centavos) }));
}

// Código de pago idempotente (ADR-007): la primera vez lo genera y lo guarda; las siguientes devuelve el mismo.
// Devuelve { expensa, codigo, creado }. Si la expensa ya está pagada → 409.
export async function asegurarCodigoDePago(id) {
  return enTransaccion(async (db) => {
    // Se bloquea la fila: dos pedidos simultáneos no pueden generar el código a la vez
    const { rows } = await db.query('SELECT id, estado, codigo_pago FROM expensas WHERE id = $1 FOR UPDATE', [id]);
    const fila = rows[0];
    if (!fila) throw new Problema(404, 'Expensa no encontrada', `No existe una expensa con id ${id}.`);
    if (fila.estado === 'PAGADA') {
      throw new Problema(409, 'Expensa ya pagada', `La expensa ${id} ya está pagada; no se puede generar un código de pago.`);
    }
    if (fila.codigo_pago) return { codigo: fila.codigo_pago, creado: false };
    const codigo = codigoDePago(id);
    await db.query('UPDATE expensas SET codigo_pago = $1 WHERE id = $2', [codigo, id]);
    return { codigo, creado: true };
  });
}
