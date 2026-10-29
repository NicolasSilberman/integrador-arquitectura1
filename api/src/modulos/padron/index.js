// Módulo PADRÓN: edificios, unidades y propietarios.
// Es dueño de las tablas consorcios y unidades; los demás módulos las consultan SOLO por esta interfaz.
import { pool } from '../../db.js';

const aUnidad = (r) => ({
  id: r.id,
  codigo: r.codigo,
  propietarioUsuario: r.propietario_usuario,
  consorcio: { id: r.consorcio_id, nombre: r.consorcio_nombre },
});

const SELECT = `SELECT u.id, u.codigo, u.propietario_usuario, u.consorcio_id, c.nombre AS consorcio_nombre
                FROM unidades u JOIN consorcios c ON c.id = u.consorcio_id`;

export async function unidadesDePropietario(usuario) {
  const { rows } = await pool.query(`${SELECT} WHERE u.propietario_usuario = $1 ORDER BY u.id`, [usuario]);
  return rows.map(aUnidad);
}

export async function unidad(id) {
  const { rows } = await pool.query(`${SELECT} WHERE u.id = $1`, [id]);
  return rows[0] ? aUnidad(rows[0]) : null;
}

// Devuelve un Map id -> unidad para armar listados sin una consulta por fila.
export async function unidadesPorIds(ids) {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(`${SELECT} WHERE u.id = ANY($1::int[])`, [ids]);
  return new Map(rows.map((r) => [r.id, aUnidad(r)]));
}
