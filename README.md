# Sistema de expensas de consorcios

TP Integrador — Arquitectura de Software 1 (UNAHUR) · Escenario 5A.

Liquidación mensual de expensas para 6 consorcios (~150 unidades). El propietario ve su liquidación y obtiene un código de pago; paga en el banco; cada mañana el sistema descarga las cobranzas del día anterior (servicio SOAP simulado) y las imputa.

- Documento de arquitectura: [`docs/arquitectura.md`](docs/arquitectura.md)
- Decisiones (ADR): [`docs/adr/`](docs/adr/)
- Contrato de la API: [`openapi.yaml`](openapi.yaml)

## Cómo levantarlo

Requisitos: Docker (o Podman) con Compose.

```bash
cp .env.example .env        # opcional: sin .env se usan valores por defecto de demo (cambia las claves de DB y Keycloak)
docker compose up -d --build
```

Esperá 1–2 minutos la primera vez: Keycloak tarda en arrancar. Para apagar: `docker compose down` (agregá `-v` para borrar también la base).

| Servicio | URL | Para qué |
|---|---|---|
| Swagger UI | http://localhost:8080 | Documentación y cliente de prueba (botón **Authorize**) |
| API | http://localhost:3000 | `GET /health` es público |
| Keycloak | http://localhost:8180 | Consola de administración: `admin` / `admin` |
| Banco simulado | http://localhost:8090 | Consola para "pagar" en la demo |

## Usuarios de prueba (sólo demo)

| Usuario | Contraseña | Rol | Qué ve |
|---|---|---|---|
| `paula` | `paula123` | propietario | 2 unidades (1A del consorcio 1, 2B del consorcio 3) |
| `pablo` | `pablo123` | propietario | 1 unidad (4C del consorcio 2) |
| `adriana` | `adriana123` | administrador | todas las expensas, concilia |

## Recorrido de demo (caso de uso mínimo)

1. Abrí Swagger UI → **Authorize** → iniciá sesión como `paula`.
2. `GET /v1/expensas` → ves tus liquidaciones del período 2026-10 (total = suma de conceptos).
3. `PUT /v1/expensas/{id}/codigo-pago` → obtenés el código (201; si lo repetís, 200 con el mismo código).
4. En la consola del banco simulado (http://localhost:8090) cargá un pago con ese código y el importe exacto de la expensa.
5. Cerrá sesión e ingresá como `adriana` → `POST /v1/conciliaciones` con la fecha del pago. La respuesta indica cuántas cobranzas se leyeron, imputaron u observaron. (A las 07:00 hora de Buenos Aires también corre sola.)
6. Volvé a entrar como `paula` → `GET /v1/expensas/{id}`: estado `PAGADA` con el pago imputado.

Otras cosas para probar: pagar dos veces (la segunda queda `OBSERVADA`), importe distinto, repetir la conciliación (no duplica), apagar el banco desde su consola (502 y la corrida queda en `ERROR`), pedir con `paula` la expensa de `pablo` (403).

## Pruebas

**En Docker** (no instala nada; usa una base descartable dentro del Postgres del compose):

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --build pruebas
```

**Local** (Node 22 y un PostgreSQL accesible):

```bash
cd api && npm ci
TEST_DB_HOST=localhost TEST_DB_PORT=5432 TEST_DB_USER=expensas TEST_DB_PASSWORD=expensas123 TEST_DB_ADMIN=postgres npm test
```

Los tests crean y borran su propia base; no tocan los datos reales. Resultado verificado durante el desarrollo: 39 de 39 pasan. Cubren seguridad (401/403/503), propiedad de los datos, el caso de uso, consistencia (concurrencia, idempotencia, índice único), resiliencia (banco caído, corrida interrumpida, planificador) y conformidad de la API con `openapi.yaml`.

## Estructura

```
api/                  API (Node.js 22 + Express 5), monolito modular
  src/modulos/        padron · liquidaciones · cobranzas (cada uno dueño de sus tablas)
  src/integraciones/banco/   cliente SOAP + traductor (capa anticorrupción)
  src/http/           autenticación, rutas, Problem Details
  src/scheduler.js    conciliación diaria con puesta al día
  test/               tests automáticos
banco-mock/           simulador del servicio SOAP del banco
db/init.sql           esquema y datos de ejemplo
keycloak/             realm versionado (roles, usuarios, cliente)
docs/                 arquitectura, ADRs, diagramas
openapi.yaml          contrato de la API
docker-compose.yml    todo el sistema
```

## Alcance

**Implementado:** login OIDC con dos roles, ver la liquidación, obtener el código de pago, conciliación automática y manual con imputación, banco SOAP simulado, API documentada.
**Diseñado, no implementado:** interfaz web (hoy Swagger UI), generar la liquidación mensual (los datos de ejemplo vienen en `db/init.sql`), resolución manual de pagos observados, mora, alertas, backups.

## Limitaciones conocidas

- Keycloak corre en modo desarrollo **sin persistencia**: los usuarios creados desde su consola se pierden al recrear el contenedor. La fuente de verdad es `keycloak/realm-expensas.json`.
- Las credenciales y secretos de este repo son **de demo**; no usar en producción.
- Sin TLS y sin backups automáticos.

## Problemas frecuentes

- **Swagger UI da error al autorizar:** esperá a que Keycloak termine de arrancar (`docker compose logs -f keycloak`) y accedé con `localhost`, no con la IP.
- **`401` con un token recién obtenido:** el token dura 5 minutos; volvé a autorizar.
- **Un puerto está ocupado:** cambiá el número de la izquierda en `ports:` de `docker-compose.yml` (los puertos no se configuran desde `.env`; si cambiás el de Keycloak, ajustá también `KEYCLOAK_PUBLIC_URL`).
- **Quiero datos limpios:** `docker compose down -v && docker compose up -d --build`.

## Pendiente de verificar por el grupo

El asistente que armó la base no tuvo Docker disponible, por lo que **no se ejecutó** `docker compose up`. Antes de la entrega:

1. Correr `docker compose up -d --build` y confirmar que los 5 servicios quedan sanos.
2. Hacer el login real desde Swagger UI con los 3 usuarios y recorrer la demo.
3. Correr la suite en Docker (comando de arriba).
4. Medir la memoria real (`docker stats`), sobre todo Keycloak, y reflejarlo en el documento.
5. Crear el tag `v1.0` en el repositorio y verificar que el README funciona desde un clon limpio.
