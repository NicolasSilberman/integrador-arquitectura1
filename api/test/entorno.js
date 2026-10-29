// Entorno de pruebas: una base descartable creada desde db/init.sql, el banco simulado en un puerto libre
// y un "proveedor de identidad" falso que firma tokens como lo haría Keycloak (así se prueba toda la validación real).
// No hace falta Docker para correr los tests: solo un Postgres accesible (ver README, sección Pruebas).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import pg from 'pg';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const ISSUER = 'http://idp.test/realms/expensas';
const AUDIENCE = 'api-expensas';

const puertoLibre = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function esperar(url, intentos = 50) {
  for (let i = 0; i < intentos; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* todavía no */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No respondió: ${url}`);
}

export async function prepararEntorno() {
  const baseDatos = {
    host: process.env.TEST_DB_HOST ?? 'localhost',
    port: Number(process.env.TEST_DB_PORT ?? 5432),
    user: process.env.TEST_DB_USER ?? 'expensas',
    password: process.env.TEST_DB_PASSWORD ?? 'expensas123',
    admin: process.env.TEST_DB_ADMIN ?? 'postgres',
  };
  const nombreDb = `expensas_test_${process.pid}`;

  // 1) Base descartable con el esquema y los datos de ejemplo reales
  const admin = new pg.Client({ host: baseDatos.host, port: baseDatos.port, user: baseDatos.user, password: baseDatos.password, database: baseDatos.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${nombreDb}`);
  await admin.query(`CREATE DATABASE ${nombreDb}`);
  const inicial = new pg.Client({ host: baseDatos.host, port: baseDatos.port, user: baseDatos.user, password: baseDatos.password, database: nombreDb });
  await inicial.connect();
  await inicial.query(readFileSync(process.env.INIT_SQL ?? new URL('../../db/init.sql', import.meta.url), 'utf8'));
  await inicial.end();

  // 2) Banco simulado (el mismo código que corre en el compose) en un puerto libre
  const puertoBanco = await puertoLibre();
  const banco = spawn('node', [process.env.BANCO_MOCK ?? new URL('../../banco-mock/index.js', import.meta.url).pathname],
    { env: { ...process.env, PORT: String(puertoBanco) }, stdio: 'ignore' });
  const bancoUrl = `http://localhost:${puertoBanco}`;
  await esperar(`${bancoUrl}/health`);

  // 3) Proveedor de identidad falso: publica un JWKS y firma tokens con RS256
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'clave-1', alg: 'RS256', use: 'sig' };
  const puertoIdp = await puertoLibre();
  const idp = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
  });
  const arrancarIdp = () => new Promise((r) => idp.listen(puertoIdp, r));
  await arrancarIdp();

  // 4) Configuración de la API ANTES de importarla (lee el entorno al cargar)
  Object.assign(process.env, {
    DB_HOST: baseDatos.host, DB_PORT: String(baseDatos.port), DB_USER: baseDatos.user, DB_PASSWORD: baseDatos.password, DB_NAME: nombreDb,
    JWKS_URL: `http://localhost:${puertoIdp}/certs`, ISSUER, AUDIENCE,
    BANCO_URL: `${bancoUrl}/soap`, BANCO_TIMEOUT_MS: '3000', ZONA_HORARIA: 'America/Argentina/Buenos_Aires',
  });
  const { crearApp } = await import('../src/app.js');
  const servidor = crearApp().listen(0);
  await new Promise((r) => servidor.on('listening', r));
  const apiUrl = `http://localhost:${servidor.address().port}`;

  const firmar = async (usuario, roles, { expiraEn = '5m', audiencia = AUDIENCE, clave = privateKey, kid = 'clave-1', emisor = ISSUER } = {}) =>
    new SignJWT({ preferred_username: usuario, realm_access: { roles } })
      .setProtectedHeader({ alg: 'RS256', kid }).setIssuer(emisor).setAudience(audiencia)
      .setIssuedAt().setExpirationTime(expiraEn).sign(clave);

  async function llamar(metodo, ruta, { token, cuerpo } = {}) {
    const resp = await fetch(apiUrl + ruta, {
      method: metodo,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await resp.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* sin cuerpo JSON */ }
    return { status: resp.status, headers: resp.headers, cuerpo: json };
  }

  // Simula que un propietario pagó en el banco (importe en centavos -> formato del banco "52000,50")
  async function pagarEnBanco(codigoPago, centavos, fecha) {
    const importe = `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`;
    const r = await fetch(`${bancoUrl}/_mock/pagos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigoPago, importe, fecha }) });
    if (r.status !== 201) throw new Error(`El banco simulado rechazó el pago: ${await r.text()}`);
  }
  const bancoFalla = (activa) => fetch(`${bancoUrl}/_mock/falla`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activa }) });

  const consultaDirecta = new pg.Pool({ host: baseDatos.host, port: baseDatos.port, user: baseDatos.user, password: baseDatos.password, database: nombreDb });
  consultaDirecta.on('error', () => {});

  // Detener el IdP de verdad: además de dejar de escuchar, cerrar las conexiones keep-alive que ya tenía abiertas.
  const pararIdp = () => new Promise((r) => { idp.close(r); idp.closeAllConnections(); });
  const { reiniciarCacheDeClaves } = await import('../src/http/auth.js');

  async function apagar() {
    servidor.close();
    idp.close();
    banco.kill();
    const { pool } = await import('../src/db.js');
    await pool.end();
    await consultaDirecta.end();
    await new Promise((r) => setTimeout(r, 200));      // dar tiempo a que Postgres registre las desconexiones antes del DROP
    await admin.query(`DROP DATABASE IF EXISTS ${nombreDb} WITH (FORCE)`);
    await admin.end();
  }

  return {
    llamar, firmar, pagarEnBanco, bancoFalla, consultaDirecta, apagar,
    idp: { parar: pararIdp, arrancar: arrancarIdp, vaciarCacheDeClaves: reiniciarCacheDeClaves },
    configApi: (await import('../src/config.js')).config,
    generarClave: () => generateKeyPair('RS256'),
  };
}
