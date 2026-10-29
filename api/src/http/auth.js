// Autenticación y autorización (ADR-005 y ADR-006).
// La API valida ella misma el token que emitió Keycloak: no hay gateway delante (un contenedor menos que operar).
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { Problema } from './problemas.js';

// Las claves públicas se descargan la primera vez que llega un token y quedan en caché.
// Por eso la API puede arrancar antes de que Keycloak esté listo.
let jwks;
const claves = () => (jwks ??= createRemoteJWKSet(new URL(config.auth.jwksUrl)));

// Solo para pruebas: simula un arranque en frío (sin claves en caché).
export const reiniciarCacheDeClaves = () => { jwks = undefined; };

// Errores de jose que significan "este token no sirve" (401). Cualquier otro error (red, timeout
// al buscar las claves) es un problema NUESTRO o de Keycloak: 503, no culpa del cliente.
const TOKEN_INVALIDO = /^ERR_(JWT|JWS|JWE|JWK|JWKS_NO_MATCHING_KEY|JWKS_MULTIPLE_MATCHING_KEYS|JOSE_ALG_NOT_ALLOWED)/;

// 401: "no sé quién sos".
export async function autenticar(req, res, next) {
  const [esquema, token] = (req.get('Authorization') ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) {
    throw new Problema(401, 'no-autenticado', 'No autenticado', 'Falta el header "Authorization: Bearer <token>".',
      { headers: { 'WWW-Authenticate': 'Bearer realm="expensas"' } });
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, claves(), { issuer: config.auth.issuer, audience: config.auth.audience }));
  } catch (err) {
    if (TOKEN_INVALIDO.test(err.code ?? '')) {
      throw new Problema(401, 'token-invalido', 'No autenticado', `Token inválido: ${err.code}.`,
        { headers: { 'WWW-Authenticate': 'Bearer realm="expensas", error="invalid_token"' } });
    }
    console.error('No se pudo validar el token (¿Keycloak caído?):', err.message);
    throw new Problema(503, 'identidad-no-disponible', 'Proveedor de identidad no disponible',
      'No se pudo verificar el token porque el proveedor de identidad no responde. Reintentá en unos minutos.');
  }
  req.usuario = {
    username: payload.preferred_username,
    nombre: payload.name ?? payload.preferred_username,
    roles: payload.realm_access?.roles ?? [],
  };
  next();
}

// 403: "sé quién sos, pero tu rol no alcanza".
export const requiereRol = (...permitidos) => (req, res, next) => {
  if (!permitidos.some((r) => req.usuario.roles.includes(r))) {
    throw new Problema(403, 'sin-permiso', 'Sin permiso',
      `${req.usuario.username} tiene los roles [${req.usuario.roles.join(', ')}] y esta operación requiere uno de [${permitidos.join(', ')}].`);
  }
  next();
};

export const esAdministrador = (usuario) => usuario.roles.includes('administrador');
