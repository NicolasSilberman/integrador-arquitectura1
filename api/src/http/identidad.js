// Identidad del usuario (ADR-006). La pone el gateway en los encabezados X-Usuario y X-Roles, después de validar
// el token. La API no publica su puerto: solo se llega a ella por el gateway, por eso confía en estos encabezados.
import { responderProblema } from './problemas.js';

export function identidad(req, res, next) {
  const usuario = req.get('X-Usuario');
  const roles = (req.get('X-Roles') ?? '').split(',').filter(Boolean);
  // Si falta, el pedido no vino por el gateway: se rechaza (ante la duda, se rechaza).
  if (!usuario || roles.length === 0) {
    return responderProblema(res, req, 401, 'No autenticado', 'El pedido no trae la identidad del usuario.');
  }
  req.identidad = { usuario, esAdministrador: roles.includes('administrador') };
  next();
}
