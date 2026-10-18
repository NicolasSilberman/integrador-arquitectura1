# Sistema de expensas de consorcios

**Trabajo Práctico Integrador · Arquitectura de Software 1 · UNAHUR**
Dominio 5 · Expensas de consorcios · Escenario **5A — Administrador independiente**

## Integrantes

- _Fernando Rodriguez_
- _Nicolas Silberman_

## Documentación

- [Documento de arquitectura](docs/arquitectura.md): problema y escenario, dominio, NFRs, matriz de Pugh y estilo, C4 de Contexto y de Contenedores, modelo de dominio y API.
- [Decisiones de arquitectura (ADRs)](docs/adr/)
- [Contrato de la API (OpenAPI)](openapi.yaml)

## Cómo levantarlo

Requisito: Docker Desktop (o Podman Desktop) funcionando.

```bash
cp .env.example .env          # en PowerShell: copy .env.example .env
docker compose up -d --build
docker compose ps
```

El archivo `.env` tiene la contraseña de la base y **no se sube al repositorio**: cada integrante lo crea a partir de `.env.example` y completa sus valores.

Para empezar de cero (por ejemplo, si cambió `db/init.sql`):

```bash
docker compose down -v
docker compose up -d --build
```

## Servicios

| Servicio | URL | Qué es |
|---|---|---|
| Swagger UI | http://localhost:8080 | Documentación del contrato y cliente de prueba |
| API de expensas | http://localhost:3000 | `GET /health` y los endpoints `/v1/...` del contrato |
| Banco simulado | http://localhost:8090 | Mock del servicio SOAP del banco (`GET /health`, `POST /soap`) |
| Base de datos | — | PostgreSQL 16, sin puerto publicado: solo la alcanza la API por la red interna |

## Estado del avance

- **15/10:** dominio y escenario, NFRs y C4 de Contexto.
- **22/10:** matriz de Pugh y estilo (monolito modular), C4 de Contenedores, modelo de dominio, contrato OpenAPI, primeros ADRs y compose levantando todos los servicios.
  - La API responde todos los endpoints del contrato con **datos de ejemplo**; todavía no consulta la base ni tiene lógica de negocio.
  - La base se crea con el esquema por módulo y datos de ejemplo de 6 consorcios y 150 unidades.
  - El banco simulado responde un listado de cobranzas de ejemplo.
- **Próximo (29/10):** login con el proveedor de identidad (OIDC) y dos roles.
