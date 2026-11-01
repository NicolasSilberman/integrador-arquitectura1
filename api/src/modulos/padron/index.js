// Módulo PADRÓN: consorcios, unidades funcionales y sus propietarios.
// Es el único que lee las tablas consorcios y unidades. Los demás módulos le piden lo que necesitan por acá.
import { pool } from '../../db.js';

const aUnidad = (r) => ({
  id: r.id,
  codigo: r.codigo,
  consorcioId: r.consorcio_id,
  consorcio: r.consorcio,
  propietario: r.propietario_usuario,   // usuario del proveedor de identidad; null si la unidad no tiene cuenta
});

const SELECT_UNIDAD = `
  SELECT u.id, u.codigo, u.consorcio_id, u.propietario_usuario, c.nombre AS consorcio
  FROM unidades u JOIN consorcios c ON c.id = u.consorcio_id`;

// Ids de las unidades de un propietario (para la regla fina)
export async function unidadesDe(usuario) {
  const { rows } = await pool.query('SELECT id FROM unidades WHERE propietario_usuario = $1', [usuario]);
  return rows.map((r) => r.id);
}

export async function unidad(id) {
  const { rows } = await pool.query(`${SELECT_UNIDAD} WHERE u.id = $1`, [id]);
  return rows[0] ? aUnidad(rows[0]) : null;
}

// Varias unidades de una vez, como un Map por id (para armar listados sin una consulta por fila)
export async function unidadesPorIds(ids) {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(`${SELECT_UNIDAD} WHERE u.id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((r) => [r.id, aUnidad(r)]));
}
