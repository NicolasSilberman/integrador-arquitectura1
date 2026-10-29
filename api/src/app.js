import express from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { autenticar } from './http/auth.js';
import { Problema, manejadorErrores, rutaInexistente } from './http/problemas.js';
import { rutasCobranzas } from './http/rutas/cobranzas.js';
import { rutasConciliaciones } from './http/rutas/conciliaciones.js';
import { rutasExpensas } from './http/rutas/expensas.js';

// CORS: Swagger UI corre en otro origen (localhost:8080) y el navegador llama a esta API (localhost:3000).
function cors(req, res, next) {
  res.set('Access-Control-Allow-Origin', config.auth.corsOrigin);
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Expose-Headers', 'Location, WWW-Authenticate');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function crearApp() {
  const app = express();
  app.use(express.json());
  app.use(cors);

  // Público (sin token): lo usa el healthcheck y quien monitorea.
  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch {
      throw new Problema(503, 'base-no-disponible', 'Base de datos no disponible', 'La API no puede conectarse a la base de datos.');
    }
    res.json({ status: 'ok' });
  });

  // Todo lo demás exige token válido. La autorización por rol se aplica en cada ruta.
  app.use('/v1', autenticar);
  app.use('/v1/expensas', rutasExpensas);
  app.use('/v1/conciliaciones', rutasConciliaciones);
  app.use('/v1/cobranzas', rutasCobranzas);

  app.use(rutaInexistente);
  app.use(manejadorErrores);
  return app;
}
