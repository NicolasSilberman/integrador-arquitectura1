// Gateway de autenticación y autorización (ADR-006).
// Es la ÚNICA puerta de entrada a la API de expensas:
//   1. valida el token que emitió Keycloak (firma, emisor, audiencia y vencimiento);
//   2. aplica los permisos por rol (matriz de permisos, documento de arquitectura, sección 9.3);
//   3. reenvía el pedido a la API agregando la identidad del usuario (X-Usuario y X-Roles).
// La regla fina ("cada propietario ve y paga solo SUS expensas") la resuelve la API, que conoce el Padrón.
import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = Number(process.env.PORT ?? 8000);
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
// Las claves PÚBLICAS de Keycloak se buscan por la red interna (service discovery: "keycloak")...
const JWKS_URL = process.env.JWKS_URL ?? 'http://localhost:8180/realms/expensas/protocol/openid-connect/certs';
// ...pero el emisor (iss) del token es la URL que vio el NAVEGADOR al loguearse.
const ISSUER = process.env.ISSUER ?? 'http://localhost:8180/realms/expensas';
const AUDIENCE = process.env.AUDIENCE ?? 'api-expensas';
// Orígenes del navegador que pueden llamar al gateway, separados por coma: Swagger UI y la interfaz web
const CORS_ORIGENES = (process.env.CORS_ORIGIN ?? 'http://localhost:8080,http://localhost:3001')
  .split(',').map((o) => o.trim()).filter(Boolean);

// Se descarga la primera vez que se valida un token y queda en caché.
// Por eso el gateway puede arrancar antes de que Keycloak esté listo.
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

// ---------- Permisos por rol (RBAC) ----------
// La misma tabla que la matriz de permisos del documento. Está en UN solo lugar.
const PROPIETARIO = 'propietario';
const ADMINISTRADOR = 'administrador';
const REGLAS = [
  { metodo: 'GET',  ruta: /^\/health$/,                       roles: null },                         // público
  { metodo: 'GET',  ruta: /^\/v1\/expensas$/,                 roles: [PROPIETARIO, ADMINISTRADOR] },
  { metodo: 'GET',  ruta: /^\/v1\/expensas\/[^/]+$/,          roles: [PROPIETARIO, ADMINISTRADOR] },
  { metodo: 'PUT',  ruta: /^\/v1\/expensas\/[^/]+\/codigo-pago$/, roles: [PROPIETARIO, ADMINISTRADOR] },
  { metodo: 'POST', ruta: /^\/v1\/conciliaciones$/,           roles: [ADMINISTRADOR] },
  { metodo: 'GET',  ruta: /^\/v1\/conciliaciones\/[^/]+$/,    roles: [ADMINISTRADOR] },
  { metodo: 'GET',  ruta: /^\/v1\/cobranzas$/,                roles: [ADMINISTRADOR] },
];

const app = express();
app.disable('x-powered-by');   // no anunciar qué framework usamos
app.use(express.json());

// Headers de seguridad en todas las respuestas (se configuran en un solo lugar: el gateway)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');                                   // el navegador no "adivina" el tipo de contenido
  res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); // la API solo devuelve datos: nada que cargar ni embeber
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');                                            // los datos de expensas no se guardan en cachés
  // HSTS (Strict-Transport-Security) solo tiene sentido con HTTPS: se agrega en producción, con TLS (ADR-009)
  next();
});

// CORS: Swagger UI (localhost:8080) y la interfaz web (localhost:3001) llaman al gateway (localhost:8000)
// con el header Authorization. Se responde con el origen del pedido solo si está en la lista.
app.use((req, res, next) => {
  const origen = req.headers.origin;
  if (origen && CORS_ORIGENES.includes(origen)) res.set('Access-Control-Allow-Origin', origen);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Expose-Headers', 'Location, WWW-Authenticate');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Errores con Problem Details (RFC 9457)
function problem(res, status, title, detail, instance, headers = {}) {
  res.set(headers).status(status).type('application/problem+json').json({
    type: 'about:blank', title, status, detail, instance,
  });
}

// ---------- Autenticación: ¿quién sos? ----------
async function autenticar(req) {
  const [esquema, token] = (req.get('Authorization') ?? '').split(' ');
  if (esquema !== 'Bearer' || !token) return { status: 401, error: 'Falta el header "Authorization: Bearer <token>".' };
  try {
    // Verifica la FIRMA con la clave pública de Keycloak, el emisor, la audiencia y el vencimiento.
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: AUDIENCE });
    return { usuario: payload };
  } catch (err) {
    // Los errores de jose tienen un código (token vencido, firma inválida, audiencia incorrecta...).
    // Si no lo tienen, no se pudieron obtener las claves: el proveedor de identidad no responde.
    if (!err.code || err.code === 'ERR_JWKS_TIMEOUT') {
      return { status: 503, error: 'No se pudo validar el token: el proveedor de identidad no responde.' };
    }
    return { status: 401, error: `Token inválido (${err.code}).` };
  }
}

const rolesDe = (usuario) => usuario?.realm_access?.roles ?? [];

// ---------- Todo pedido: autenticar, autorizar y reenviar a la API ----------
app.use(async (req, res) => {
  const regla = REGLAS.find((r) => r.metodo === req.method && r.ruta.test(req.path));
  if (!regla) return problem(res, 404, 'No encontrado', `No existe la ruta ${req.method} ${req.path}.`, req.originalUrl);

  // La identidad solo la pone el gateway: se descarta cualquier X-Usuario o X-Roles que mande el cliente.
  const identidad = {};

  if (regla.roles) {
    const { usuario, status, error } = await autenticar(req);
    if (error && status === 503) return problem(res, 503, 'Identidad no disponible', error, req.originalUrl);
    // 401: no sé quién sos
    if (error) return problem(res, 401, 'No autenticado', error, req.originalUrl, { 'WWW-Authenticate': 'Bearer realm="expensas"' });
    // 403: sé quién sos, pero tu rol no alcanza
    const roles = rolesDe(usuario);
    if (!regla.roles.some((r) => roles.includes(r))) {
      return problem(res, 403, 'Sin permiso',
        `${usuario.preferred_username} tiene los roles [${roles.join(', ')}] y esta operación requiere uno de [${regla.roles.join(', ')}].`,
        req.originalUrl);
    }
    identidad['X-Usuario'] = usuario.preferred_username;
    identidad['X-Roles'] = roles.filter((r) => r === PROPIETARIO || r === ADMINISTRADOR).join(',');
  }

  try {
    const resp = await fetch(API_URL + req.originalUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', ...identidad },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body ?? {}) : undefined,
    });
    // Solo se copian los headers que importan (el CORS lo maneja el gateway, no la API)
    for (const h of ['content-type', 'location', 'retry-after']) if (resp.headers.get(h)) res.set(h, resp.headers.get(h));
    res.status(resp.status).send(Buffer.from(await resp.arrayBuffer()));
  } catch (err) {
    console.error(err.message);
    problem(res, 502, 'API no disponible', 'El gateway no pudo comunicarse con la API.', req.originalUrl);
  }
});

app.listen(PORT, () => console.log(`Gateway en ${PORT} → API ${API_URL} · emisor esperado ${ISSUER}`));
