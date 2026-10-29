# ADR-007: API REST nivel 2, contract-first con OpenAPI 3.1, versionada y con Problem Details

- **Estado:** Aceptado
- **Fecha:** 22/10/2026

## Contexto
La consigna pide una API documentada (OpenAPI), con semántica HTTP correcta, errores estandarizados y versionado.

## Decisión
- **Contract-first:** `openapi.yaml` (3.1.0) se escribe primero y es el contrato. Un test (`contrato.test.js`) verifica con `ajv` que las respuestas reales cumplen el esquema y los códigos de estado documentados.
- **REST nivel 2** (recursos + verbos + códigos): `GET /v1/expensas`, `GET /v1/expensas/{id}`, `PUT /v1/expensas/{id}/codigo-pago`, `POST/GET /v1/conciliaciones`, `GET /v1/cobranzas`.
- **`PUT` para el código de pago**: es idempotente por definición (mismo resultado al repetirlo): 201 al crearlo, 200 al repetirlo.
- **Versionado en la URI** (`/v1`).
- **Errores con Problem Details (RFC 9457)**, `application/problem+json`, con `type` en `https://expensas.example/problemas/<slug>`.
- **Swagger UI** como documentación navegable y cliente de prueba (con login OIDC).

## Alternativas consideradas
| Alternativa | Por qué no |
|---|---|
| Code-first (generar el contrato desde el código) | El contrato queda como subproducto y puede divergir sin aviso. |
| Versionar por header | Menos visible y más difícil de probar a mano; la URI es más simple. |
| GraphQL / gRPC | Sin necesidad que lo justifique; más complejidad. |
| HATEOAS (nivel 3) | Sin beneficio con un único cliente conocido. |

## Consecuencias
- (+) Documentación y comportamiento verificados juntos: 25 chequeos de conformidad en el test de contrato.
- (+) Errores consistentes y legibles por máquina.
- (−) Hay que mantener el YAML a mano; el test de contrato avisa si diverge.
- (−) Hoy el lint de OpenAPI (Redocly) tiene 3 advertencias menores (licencia estricta, servidor `example.com`, `/health` sin 4xx), sin impacto funcional.
- (−) La liquidación (`POST` para generar expensas) está diseñada pero fuera del corte implementado.

## NFR relacionados
Mantenibilidad, interoperabilidad, calidad de documentación.
