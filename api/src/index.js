import express from 'express';
import pg from 'pg';

const app = express();
app.use(express.json());

// La configuración llega por variables de entorno (las define docker-compose.yml)
const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'cursos',
  user: process.env.DB_USER ?? 'cursos',
  password: process.env.DB_PASSWORD ?? 'cursos123',
});

// CORS: Swagger UI corre en otro origen (localhost:8080) y el navegador llama a localhost:3000
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Errores con Problem Details (RFC 9457), como vimos en la Clase 9
function problem(res, status, title, detail, instance) {
  res.status(status).type('application/problem+json').json({
    type: 'about:blank', title, status, detail, instance,
  });
}

const aCurso = (r) => ({ id: r.id, nombre: r.nombre, cupo: r.cupo, docente: r.docente, descripcion: r.descripcion, creadoEn: r.creado_en });

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

app.get('/cursos', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cursos ORDER BY id');
  res.json(rows.map(aCurso));
});

app.get('/cursos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return problem(res, 400, 'Id inválido', 'El id debe ser un número entero.', req.originalUrl);
  const { rows } = await pool.query('SELECT * FROM cursos WHERE id = $1', [id]);
  if (rows.length === 0) return problem(res, 404, 'Curso no encontrado', `No existe un curso con id ${id}.`, req.originalUrl);
  res.json(aCurso(rows[0]));
});

app.post('/cursos', async (req, res) => {
  const { nombre, cupo, docente = null, descripcion = null } = req.body ?? {};
  if (typeof nombre !== 'string' || nombre.trim() === '' || !Number.isInteger(cupo) || cupo <= 0) {
    return problem(res, 400, 'Datos inválidos', 'Se requiere "nombre" (texto) y "cupo" (entero mayor a 0).', req.originalUrl);
  }
  const { rows } = await pool.query(
    'INSERT INTO cursos (nombre, cupo, docente, descripcion) VALUES ($1, $2, $3, $4) RETURNING *',
    [nombre.trim(), cupo, docente, descripcion],
  );
  res.status(201).location(`/cursos/${rows[0].id}`).json(aCurso(rows[0]));
});

app.delete('/cursos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return problem(res, 400, 'Id inválido', 'El id debe ser un número entero.', req.originalUrl);
  const { rowCount } = await pool.query('DELETE FROM cursos WHERE id = $1', [id]);
  if (rowCount === 0) return problem(res, 404, 'Curso no encontrado', `No existe un curso con id ${id}.`, req.originalUrl);
  res.sendStatus(204);
});

// Cualquier error no previsto (ej: la base no responde) también sale como Problem Details
app.use((err, req, res, next) => {
  console.error(err);
  problem(res, 500, 'Error interno', 'Ocurrió un error inesperado.', req.originalUrl);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API de cursos escuchando en el puerto ${port} (DB en ${process.env.DB_HOST ?? 'localhost'})`));
