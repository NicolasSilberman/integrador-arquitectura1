import pg from 'pg';
import { config } from './config.js';

// BIGINT (centavos) llega como número: los importes del sistema caben de sobra en 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// DATE llega como texto "2026-11-10": evita que el driver lo convierta a Date y lo corra por zona horaria.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool(config.db);

// Si Postgres se reinicia, las conexiones inactivas del pool emiten "error". Sin este manejador el evento
// no capturado TUMBA el proceso entero; con él, el pool descarta la conexión y abre otra en el próximo uso.
pool.on('error', (err) => console.error('Conexión inactiva a la base perdida (se reabrirá sola):', err.message));

// Ejecuta fn dentro de una transacción ACID: o se aplica todo, o no se aplica nada.
export async function tx(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}
