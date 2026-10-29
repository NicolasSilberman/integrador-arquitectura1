// Toda la configuración llega por variables de entorno (las define docker-compose.yml).
// Los valores por defecto sirven para desarrollo local; los secretos reales van en el .env (fuera del repo).
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  db: {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME ?? 'expensas',
    user: env.DB_USER ?? 'expensas',
    password: env.DB_PASSWORD ?? 'expensas123',
  },
  auth: {
    // Las claves PÚBLICAS de Keycloak se buscan por la red interna (nombre del servicio)...
    jwksUrl: env.JWKS_URL ?? 'http://localhost:8180/realms/expensas/protocol/openid-connect/certs',
    // ...pero el emisor (iss) del token es la URL que vio el NAVEGADOR al loguearse.
    issuer: env.ISSUER ?? 'http://localhost:8180/realms/expensas',
    audience: env.AUDIENCE ?? 'api-expensas',
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:8080',
  },
  banco: {
    url: env.BANCO_URL ?? 'http://localhost:8090/soap',
    timeoutMs: Number(env.BANCO_TIMEOUT_MS ?? 10000),
  },
  conciliacion: {
    automatica: env.CONCILIACION_AUTOMATICA !== 'false',
    hora: env.CONCILIACION_HORA ?? '07:00',            // hora local a partir de la cual se descarga la cobranza de ayer
    reintentoMin: Number(env.CONCILIACION_REINTENTO_MIN ?? 30),
    maxDiasAtrasados: Number(env.CONCILIACION_MAX_DIAS ?? 7),
  },
  zonaHoraria: env.ZONA_HORARIA ?? 'America/Argentina/Buenos_Aires',
};
