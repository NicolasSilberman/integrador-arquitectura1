// Errores con Problem Details (RFC 9457).
import { baseNoDisponible } from '../db.js';

// Un error "esperado" del dominio o de la API, que se responde con su código HTTP.
export class Problema extends Error {
  constructor(status, title, detail) {
    super(detail);
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

export function responderProblema(res, req, status, title, detail) {
  res.status(status).type('application/problem+json').json({
    type: 'about:blank', title, status, detail, instance: req.originalUrl,
  });
}

// Ruta inexistente → 404
export function rutaInexistente(req, res) {
  responderProblema(res, req, 404, 'No encontrado', `No existe la ruta ${req.method} ${req.path}.`);
}

// Último manejador: los Problema se responden con su código; si la base no responde, 503 (se puede reintentar);
// cualquier otro error es un 500 sin detalles internos.
// eslint-disable-next-line no-unused-vars
export function manejadorDeErrores(err, req, res, next) {
  if (err instanceof Problema) return responderProblema(res, req, err.status, err.title, err.detail);
  if (baseNoDisponible(err)) {
    console.error(`[db] base no disponible: ${err.code ?? err.message}`);
    res.set('Retry-After', '30');
    return responderProblema(res, req, 503, 'Base de datos no disponible',
      'La base de datos no responde en este momento. No se perdió ningún dato; probá de nuevo en unos segundos.');
  }
  console.error(err);
  responderProblema(res, req, 500, 'Error interno', 'Ocurrió un error inesperado.');
}
