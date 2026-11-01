// Armado de la aplicación Express: middlewares, rutas y manejo de errores.
import express from 'express';
import { pool } from './db.js';
import { identidad } from './http/identidad.js';
import { rutas } from './http/rutas.js';
import { rutaInexistente, manejadorDeErrores } from './http/problemas.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Público: lo usa el gateway sin token
app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

// Todo lo de /v1 necesita la identidad que pone el gateway
app.use('/v1', identidad, rutas);

app.use(rutaInexistente);
app.use(manejadorDeErrores);
