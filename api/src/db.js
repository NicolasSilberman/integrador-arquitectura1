// Conexión a la base (una sola base, ADR-002). La API se conecta con su usuario propio, api_expensas (ADR-008).
import pg from 'pg';

// Los importes son BIGINT (centavos): se leen como número entero de JavaScript.
// Alcanza de sobra: el máximo entero exacto es 9 billones de billones de centavos.
pg.types.setTypeParser(20, (v) => Number(v));
// Las fechas (DATE) se devuelven tal cual vienen de la base, como texto AAAA-MM-DD, sin zonas horarias.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'expensas',
  user: process.env.DB_USER ?? 'api_expensas',
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000,   // si la base no responde, el pedido falla a los 5 s en lugar de quedar colgado
});

// Si una conexión ociosa se corta (por ejemplo, porque se reinició la base), se registra y el pool sigue.
// Sin esto, el error haría caer todo el proceso de la API.
pool.on('error', (err) => console.error('[db] conexión ociosa perdida:', err.message));

// Ejecuta una función dentro de una transacción: COMMIT si termina bien, ROLLBACK si falla.
export async function enTransaccion(fn) {
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

// ¿El error es porque la base no está disponible (caída, reiniciándose o inalcanzable)?
// Esos errores se responden con 503: no es un error del pedido, y en cuanto la base vuelve el pool se reconecta solo.
const CODIGOS_SIN_BASE = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'EPIPE',
  '57P01', '57P02', '57P03',                    // la base se está apagando o todavía no acepta conexiones
  '08000', '08001', '08003', '08004', '08006',  // errores de conexión de PostgreSQL
]);
export function baseNoDisponible(err) {
  return CODIGOS_SIN_BASE.has(err?.code)
    || /Connection terminated|timeout exceeded when trying to connect/i.test(err?.message ?? '');
}
