# Sistema de expensas de consorcios

**Trabajo Práctico Integrador · Arquitectura de Software 1 · UNAHUR**
Dominio 5 · Expensas de consorcios · Escenario **5A — Administrador independiente**

## Integrantes

- _Fernando Rodriguez_
- _Nicolas Silberman_

## Documentación

- [Documento de arquitectura](docs/arquitectura.md): problema y escenario, dominio, NFRs, matriz de Pugh y estilo, C4 de Contexto y de Contenedores, modelo de dominio, API, seguridad y verificación de los NFRs.
- [Decisiones de arquitectura (ADRs)](docs/adr/): ADR-001 a ADR-010.
- [Contrato de la API (OpenAPI)](openapi.yaml)
- [Verificación manual de los NFRs](docs/verificacion.md): 18 pruebas con sus resultados y capturas.

## Cómo levantarlo

Requisito: Docker Desktop (o Podman Desktop) funcionando.

```bash
cp .env.example .env          # en PowerShell: copy .env.example .env
docker compose up -d --build
docker compose ps
```

El archivo `.env` tiene las claves del sistema. **No se sube al repositorio**: cada integrante lo crea a partir de `.env.example` y completa sus valores.

| Variable | Para qué es |
|---|---|
| `DB_PASSWORD` | Contraseña del dueño de la base (la usa Postgres al crearla) |
| `API_DB_PASSWORD` | Contraseña del usuario propio de la API en la base (`api_expensas`, con permisos mínimos) |
| `KEYCLOAK_ADMIN_PASSWORD` | Contraseña de la consola de Keycloak (usuario `admin`) |
| `BANCO_API_KEY` | API key con la que la API se autentica ante el banco (la usan la API y el banco simulado) |

Keycloak tarda uno o dos minutos en arrancar; el login funciona cuando `docker compose ps` lo muestra como `healthy`.

### Empezar de cero

Los scripts de `db/` (el esquema con los datos de ejemplo y el usuario de la API) corren **solo cuando la base está vacía**. Si se actualiza el repositorio desde una versión anterior, o si cambia algo en `db/`, hay que borrar el volumen:

```bash
docker compose down -v
docker compose up -d --build
```

Si no se hace, la API puede responder 500 porque su usuario de base todavía no existe (en el log: `password authentication failed`). `down -v` también vacía los pagos cargados en el banco simulado.

## Servicios

| Servicio | URL | Qué es |
|---|---|---|
| Swagger UI | http://localhost:8080 | Documentación del contrato y cliente de prueba, con login |
| Gateway | http://localhost:8000 | Única puerta de entrada a la API: valida el token y aplica los permisos por rol |
| Keycloak | http://localhost:8180 | Proveedor de identidad. Consola: usuario `admin` y la contraseña de `KEYCLOAK_ADMIN_PASSWORD` |
| Banco simulado | http://localhost:8090 | Consola para registrar los pagos que hacen los propietarios en el banco y simular caídas del servicio. Expone el servicio SOAP que consulta la API (`POST /soap`) |
| API de expensas | — | Sin puerto publicado: solo se llega a través del gateway |
| Base de datos | — | PostgreSQL 16, sin puerto publicado: solo la alcanza la API por la red interna |

## Usuarios de prueba

| Usuario | Contraseña | Rol | Qué puede hacer |
|---|---|---|---|
| `paula` | `paula123` | propietario | Ve y paga sus expensas: la 1 (unidad 2B del consorcio 1) y la 51 (unidad 1A del consorcio 3) |
| `pablo` | `pablo123` | propietario | Ve y paga su expensa: la 26 (unidad 4C del consorcio 2) |
| `adriana` | `adriana123` | administrador | Ve todas las expensas, pide códigos de pago y concilia |

Son usuarios de demostración, definidos en el realm versionado (`keycloak/realm-expensas.json`).

## Cómo probar el login en Swagger UI

1. Abrir http://localhost:8080 y hacer clic en **Authorize**.
2. El campo `client_id` ya viene completo con `swagger-ui`: **no** hay que escribir ahí el usuario. Dejar el secreto vacío, tildar los scopes y hacer clic en **Authorize**.
3. En la pantalla de Keycloak, entrar con un usuario de prueba.
4. De vuelta en Swagger, probar los endpoints. Por ejemplo:
   - como `paula`, `GET /v1/expensas` devuelve solo sus expensas y `GET /v1/expensas/26` (de `pablo`) devuelve **403**;
   - como `paula`, `POST /v1/conciliaciones` devuelve **403**; como `adriana`, **201**;
   - sin loguearse, cualquier endpoint salvo `/health` devuelve **401**.

El token dura 5 minutos: si un pedido devuelve 401, hay que volver a hacer **Authorize** (con **Logout** primero).

## Recorrido de la demo: de la expensa al pago conciliado

1. **Pedir el código de pago.** Como `paula`: `PUT /v1/expensas/1/codigo-pago`. Responde 201 con el código (`00000000018`) y el importe en centavos (`5020001`). Repetirlo devuelve el mismo código con 200.
2. **Pagar en el banco.** En la consola del banco (http://localhost:8090), registrar un pago con ese código, el importe **en pesos** (`50200,01`, o sea los centavos divididos por 100) y la fecha del pago.
3. **Conciliar.** Como `adriana`: `POST /v1/conciliaciones` con `{"fecha": "AAAA-MM-DD"}`, la fecha del pago. Responde 201 con la corrida: cuántas cobranzas leyó, imputó u observó.
4. **Ver la expensa pagada.** Como `paula`: `GET /v1/expensas/1` muestra `"estado": "PAGADA"` y el pago imputado.

Si el importe no es exacto, o el código no existe, o la expensa ya estaba pagada, la cobranza queda **observada** con su motivo (`GET /v1/cobranzas`, como `adriana`). Conciliar de nuevo la misma fecha no duplica nada. Con **Simular caída** en la consola del banco, la conciliación responde 502 y la corrida queda registrada con error para reintentarla.

### Conciliación automática

La API concilia sola todos los días, a partir de una hora configurable, los días que todavía no tienen una conciliación exitosa (hasta el día anterior). Si el banco falla, reintenta más tarde sin saltear días (ADR-004). Se configura con variables de entorno, que tienen valores por defecto en el `docker-compose.yml`:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `CONCILIACION_AUTOMATICA` | `true` | `false` la apaga |
| `CONCILIACION_HORA` | `07:00` | Hora de Argentina desde la que corre |
| `CONCILIACION_REINTENTO_MIN` | `30` | Minutos de espera antes de reintentar un día que falló |
| `CONCILIACION_MAX_DIAS` | `7` | Cuántos días atrasados recupera como máximo |

Para verla funcionar sin esperar a la mañana siguiente, desde PowerShell:

```powershell
$env:CONCILIACION_HORA="00:00"; docker compose up -d api
docker compose logs api
```

## Estado del avance

- **15/10:** dominio y escenario, NFRs y C4 de Contexto.
- **22/10:** matriz de Pugh y estilo (monolito modular), C4 de Contenedores, modelo de dominio, contrato OpenAPI, primeros ADRs y compose levantando todos los servicios.
- **29/10:** login con Keycloak (OIDC, Authorization Code + PKCE) y dos roles; gateway que valida el token y aplica los permisos por rol; la API resuelve la regla fina (cada propietario ve y paga solo lo suyo) y quedó sin puerto publicado.
- **05/11:** el caso de uso completo contra la base: código de pago, conciliación con el banco por SOAP (capa anticorrupción y API key) con las garantías contra el cobro doble, y conciliación automática diaria. Mínimo privilegio en la base y en los contenedores, headers de seguridad en el gateway, ADR-001 a ADR-010 y verificación manual de los NFRs con 18 pruebas.
