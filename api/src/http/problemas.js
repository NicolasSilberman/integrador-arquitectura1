// Errores con Problem Details (RFC 9457, application/problem+json).
// "type" identifica el TIPO de problema (el cliente puede programar contra él); "detail" explica ESTA ocurrencia.
const BASE_TIPOS = 'https://expensas.example/problemas/';

export class Problema extends Error {
  constructor(status, slug, title, detail, { headers = {}, extra = {} } = {}) {
    super(detail);
    this.status = status;
    this.slug = slug;
    this.title = title;
    this.detail = detail;
    this.headers = headers;
    this.extra = extra;
  }
}

export function responderProblema(res, req, p) {
  res.set(p.headers).status(p.status).type('application/problem+json').json({
    type: BASE_TIPOS + p.slug,
    title: p.title,
    status: p.status,
    detail: p.detail,
    instance: req.originalUrl,
    ...p.extra,
  });
}

export function rutaInexistente(req, res) {
  responderProblema(res, req, new Problema(404, 'ruta-inexistente', 'No encontrado', `No existe ${req.method} ${req.path}.`));
}

// Cualquier error, previsto o no, sale como Problem Details. Nunca se filtra un stack trace al cliente.
export function manejadorErrores(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof Problema) return responderProblema(res, req, err);
  if (err.type === 'entity.parse.failed') {
    return responderProblema(res, req, new Problema(400, 'json-invalido', 'JSON inválido', 'El cuerpo del pedido no es JSON válido.'));
  }
  console.error(err);
  responderProblema(res, req, new Problema(500, 'error-interno', 'Error interno', 'Ocurrió un error inesperado.'));
}
