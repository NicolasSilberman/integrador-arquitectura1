# Sistema de expensas de consorcios

**Trabajo Práctico Integrador · Arquitectura de Software 1 · UNAHUR**
Dominio 5 · Expensas de consorcios · Escenario **5A — Administrador independiente**

## Integrantes

- _Fernando Rodriguez_
- _Nicolas Silberman_

## Documentación

- [Documento de arquitectura](docs/arquitectura.md): problema y escenario, dominio, NFRs, matriz de Pugh y estilo, C4 de Contexto y de Contenedores, modelo de dominio, API y seguridad (roles y matriz de permisos).
- [Decisiones de arquitectura (ADRs)](docs/adr/)
- [Contrato de la API (OpenAPI)](openapi.yaml)

## Cómo levantarlo

Requisito: Docker Desktop (o Podman Desktop) funcionando.

```bash
cp .env.example .env          # en PowerShell: copy .env.example .env
docker compose up -d --build
docker compose ps
```

El archivo `.env` tiene las contraseñas de la base (`DB_PASSWORD`) y de la consola de Keycloak (`KEYCLOAK_ADMIN_PASSWORD`). **No se sube al repositorio**: cada integrante lo crea a partir de `.env.example` y completa sus valores.

Keycloak tarda uno o dos minutos en arrancar; el login funciona cuando `docker compose ps` lo muestra como `healthy`.

Para empezar de cero (por ejemplo, si cambió `db/init.sql`):

```bash
docker compose down -v
docker compose up -d --build
```

## Servicios

| Servicio | URL | Qué es |
|---|---|---|
| Swagger UI | http://localhost:8080 | Documentación del contrato y cliente de prueba, con login |
| Gateway | http://localhost:8000 | Única puerta de entrada a la API: valida el token y aplica los permisos por rol |
| Keycloak | http://localhost:8180 | Proveedor de identidad. Consola: usuario `admin` y la contraseña de `KEYCLOAK_ADMIN_PASSWORD` |
| Banco simulado | http://localhost:8090 | Mock del servicio SOAP del banco (`GET /health`, `POST /soap`) |
| API de expensas | — | Sin puerto publicado: solo se llega a través del gateway |
| Base de datos | — | PostgreSQL 16, sin puerto publicado: solo la alcanza la API por la red interna |

## Usuarios de prueba

| Usuario | Contraseña | Rol | Qué puede hacer |
|---|---|---|---|
| `paula` | `paula123` | propietario | Ve y paga sus expensas (unidades 2B del consorcio 1 y 1A del consorcio 3) |
| `pablo` | `pablo123` | propietario | Ve y paga su expensa (unidad 4C del consorcio 2) |
| `adriana` | `adriana123` | administrador | Ve todas las expensas, pide códigos de pago y concilia |

Son usuarios de demostración, definidos en el realm versionado (`keycloak/realm-expensas.json`).

## Cómo probar el login en Swagger UI

1. Abrir http://localhost:8080 y hacer clic en **Authorize**.
2. El campo `client_id` ya viene completo con `swagger-ui`: **no** hay que escribir ahí el usuario. Dejar el secreto vacío, tildar los scopes y hacer clic en **Authorize**.
3. En la pantalla de Keycloak, entrar con un usuario de prueba.
4. De vuelta en Swagger, probar los endpoints. Por ejemplo:
   - como `paula`, `GET /v1/expensas` devuelve solo sus expensas y `GET /v1/expensas/14` (de `pablo`) devuelve **403**;
   - como `paula`, `POST /v1/conciliaciones` devuelve **403**; como `adriana`, **201**;
   - sin loguearse, cualquier endpoint salvo `/health` devuelve **401**.

El token dura 5 minutos: si un pedido devuelve 401, hay que volver a hacer **Authorize**.

## Estado del avance

- **15/10:** dominio y escenario, NFRs y C4 de Contexto.
- **22/10:** matriz de Pugh y estilo (monolito modular), C4 de Contenedores, modelo de dominio, contrato OpenAPI, primeros ADRs y compose levantando todos los servicios.
- **29/10:** login con Keycloak (OIDC, Authorization Code + PKCE) y dos roles; gateway que valida el token y aplica los permisos por rol; la API resuelve la regla fina (cada propietario ve y paga solo lo suyo) y quedó sin puerto publicado.
  - La API sigue respondiendo con **datos de ejemplo**; todavía no consulta la base ni tiene lógica de negocio.
- **Próximo (05/11):** el caso de uso completo, la conciliación con el banco y la verificación de los NFRs.
